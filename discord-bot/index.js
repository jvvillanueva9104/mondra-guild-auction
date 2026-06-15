import 'dotenv/config'
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} from 'discord.js'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const {
  DISCORD_BOT_TOKEN,
  DISCORD_GUILD_ID,
  DISCORD_CHECKIN_CHANNEL_ID,
  DISCORD_OFFICER_ROLE_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CHECKIN_EMOJI = '✅',
} = process.env

if (!DISCORD_BOT_TOKEN || !DISCORD_GUILD_ID || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required env vars. Copy .env.example to .env')
  process.exit(1)
}

if (
  SUPABASE_SERVICE_ROLE_KEY.startsWith('sb_publishable_')
  || SUPABASE_SERVICE_ROLE_KEY === process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
) {
  console.error(`
SUPABASE_SERVICE_ROLE_KEY must be the Supabase SECRET key (sb_secret_...), not the publishable/anon key.
After officer login (migration 005), the bot needs the secret key to read events and post check-in.

Supabase → Settings → API → Secret keys → reveal and copy the secret key into discord-bot/.env
`)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
})
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Message, Partials.Reaction, Partials.User],
})

function isOfficer(member) {
  if (!member) return false
  if (member.permissions.has(PermissionsBitField.Flags.ManageGuild)) return true
  if (DISCORD_OFFICER_ROLE_ID && member.roles.cache.has(DISCORD_OFFICER_ROLE_ID)) return true
  return false
}

function displayName(member) {
  return member?.nickname || member?.displayName || member?.user?.username || 'Unknown'
}

function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

async function findMemberByDiscordId(discordId) {
  const { data } = await supabase.from('members').select('id, name').eq('discord_id', discordId).maybeSingle()
  return data
}

async function upsertMemberFromDiscord(guildMember) {
  const discordId = guildMember.user.id
  const name = displayName(guildMember)
  const existing = await findMemberByDiscordId(discordId)
  if (existing) return existing

  const { data, error } = await supabase
    .from('members')
    .insert({ name, discord_id: discordId, status: 'active', is_auction_eligible: true })
    .select('id, name')
    .single()

  if (error?.code === '23505') {
    return findMemberByDiscordId(discordId)
  }
  if (error) throw error
  return data
}

async function listDraftEvents(type) {
  let query = supabase
    .from('events')
    .select('id, type, event_date, status, created_at')
    .eq('status', 'draft')
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (type) query = query.eq('type', type)

  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

async function getDraftEventById(eventId) {
  const { data, error } = await supabase
    .from('events')
    .select('id, type, event_date, status')
    .eq('id', eventId)
    .single()
  if (error || !data) return null
  if (data.status !== 'draft') return null
  return data
}

/** Pick today's draft for the type, otherwise the most recent draft for that type. */
async function resolveDraftEventByType(type) {
  const drafts = await listDraftEvents(type)
  if (!drafts.length) return null
  const today = todayDate()
  return drafts.find(event => event.event_date === today) ?? drafts[0]
}

async function getOpenCheckinEvent() {
  const { data, error } = await supabase
    .from('events')
    .select('id, type, event_date, status, checkin_message_id, checkin_channel_id')
    .eq('checkin_open', true)
    .in('status', ['draft'])
    .order('event_date', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

async function markPresent(eventId, memberId) {
  const { error } = await supabase.from('attendance').upsert(
    { event_id: eventId, member_id: memberId, status: 'present', source: 'discord_reaction' },
    { onConflict: 'event_id,member_id' },
  )
  if (error) throw error
}

async function removePresent(eventId, memberId) {
  await supabase.from('attendance').delete().eq('event_id', eventId).eq('member_id', memberId)
}

async function openCheckin(event, channel) {
  await supabase.from('events').update({ checkin_open: false }).eq('checkin_open', true)

  const embed = new EmbedBuilder()
    .setTitle('Guild Event Check-In')
    .setDescription(
      `React with ${CHECKIN_EMOJI} if you are here for **${event.type}** on **${event.event_date}**.\n\n` +
      'First time? You are added to the roster automatically.\n' +
      'Remove your reaction to undo check-in.',
    )

  const message = await channel.send({ embeds: [embed] })
  await message.react(CHECKIN_EMOJI)

  await supabase.from('events').update({
    checkin_open: true,
    checkin_message_id: message.id,
    checkin_channel_id: message.channel.id,
  }).eq('id', event.id)

  return message
}

async function getCheckinChannel() {
  if (!DISCORD_CHECKIN_CHANNEL_ID) return null
  const guild = client.guilds.cache.get(DISCORD_GUILD_ID)
  if (!guild) {
    console.error('Guild not found in cache for check-in channel lookup')
    return null
  }
  const channel = await guild.channels.fetch(DISCORD_CHECKIN_CHANNEL_ID).catch(err => {
    console.error('Could not fetch check-in channel:', err.message)
    return null
  })
  if (!channel?.isTextBased()) {
    console.error('DISCORD_CHECKIN_CHANNEL_ID is not a text channel the bot can use')
    return null
  }
  return channel
}

async function autoOpenCheckinForEvent(eventRecord) {
  if (eventRecord.status !== 'draft') return
  if (eventRecord.checkin_message_id) return

  const channel = await getCheckinChannel()
  if (!channel) {
    console.log(
      `Draft created (${eventRecord.type} · ${eventRecord.event_date}) — set DISCORD_CHECKIN_CHANNEL_ID to auto-post check-in`,
    )
    return
  }

  const { data: fresh, error } = await supabase
    .from('events')
    .select('id, type, event_date, status, checkin_message_id')
    .eq('id', eventRecord.id)
    .single()
  if (error) throw error
  if (!fresh || fresh.checkin_message_id || fresh.status !== 'draft') return

  await openCheckin(fresh, channel)
  console.log(`Auto check-in posted for ${fresh.type} · ${fresh.event_date} in #${channel.name}`)
}

async function catchUpDraftCheckins() {
  if (!DISCORD_CHECKIN_CHANNEL_ID) return

  const { data, error } = await supabase
    .from('events')
    .select('id, type, event_date, status, checkin_message_id')
    .eq('status', 'draft')
    .is('checkin_message_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (data) await autoOpenCheckinForEvent(data)
}

function startDraftEventWatch() {
  return supabase
    .channel('draft-events')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events' }, payload => {
      const row = payload.new
      if (row.status !== 'draft') return
      autoOpenCheckinForEvent(row).catch(err => console.error('Auto check-in failed:', err.message))
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('Watching for new draft events (Supabase Realtime)…')
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`Realtime ${status}:`, err?.message ?? 'unknown error')
        console.error('Run supabase/migrations/004_realtime_events.sql in Supabase SQL Editor.')
      } else if (status !== 'CLOSED') {
        console.log('Realtime status:', status)
      }
    })
}

function startDraftEventPolling(intervalMs = 15000) {
  return setInterval(() => {
    catchUpDraftCheckins().catch(err => console.error('Check-in poll failed:', err.message))
  }, intervalMs)
}

async function setupAutoCheckin() {
  if (!DISCORD_CHECKIN_CHANNEL_ID) {
    console.log('DISCORD_CHECKIN_CHANNEL_ID not set — use /start-checkin manually, or set the channel ID for auto check-in.')
    return
  }

  const channel = await getCheckinChannel()
  if (!channel) {
    console.error('DISCORD_CHECKIN_CHANNEL_ID is set but the bot cannot access that channel — check the ID and bot permissions (View Channel, Send Messages, Add Reactions).')
    return
  }

  console.log(`Auto check-in channel: #${channel.name}`)

  try {
    await catchUpDraftCheckins()
    startDraftEventWatch()
    startDraftEventPolling()
    console.log('Auto check-in active (Realtime + 15s polling fallback).')
  } catch (err) {
    console.error('Auto check-in setup failed:', err.message)
    console.error('Polling fallback will still retry every 15s.')
    startDraftEventPolling()
  }
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('start-checkin')
      .setDescription('Open Discord check-in for a draft event (officers only)')
      .addStringOption(opt =>
        opt
          .setName('type')
          .setDescription('Which event tonight? Uses today\'s draft, or the latest if none today.')
          .setRequired(true)
          .addChoices({ name: 'EO (Sunday)', value: 'EO' }, { name: 'Guild League', value: 'GL' }),
      )
      .addStringOption(opt =>
        opt
          .setName('event')
          .setDescription('Optional — pick a specific draft if you have more than one')
          .setRequired(false)
          .setAutocomplete(true),
      ),
    new SlashCommandBuilder()
      .setName('stop-checkin')
      .setDescription('Close the active Discord check-in (officers only)'),
    new SlashCommandBuilder()
      .setName('checkin-status')
      .setDescription('Show the active check-in event'),
  ].map(c => c.toJSON())

  const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN)
  await rest.put(Routes.applicationGuildCommands(client.user.id, DISCORD_GUILD_ID), { body: commands })
}

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`)

  const guild = client.guilds.cache.get(DISCORD_GUILD_ID)
  if (!guild) {
    console.error(`
Could not find guild ${DISCORD_GUILD_ID}.
- Check DISCORD_GUILD_ID in .env (right-click your server → Copy Server ID)
- Re-invite the bot to that server (OAuth2 URL with bot + applications.commands scopes)
`)
    return
  }

  try {
    await registerCommands()
    console.log(`Slash commands registered for guild "${guild.name}" (${DISCORD_GUILD_ID})`)
  } catch (err) {
    console.error(`
Failed to register slash commands (Missing Access usually means):
1. DISCORD_GUILD_ID does not match the server the bot is in
2. Bot was invited without the "applications.commands" scope — generate a new invite URL and re-add the bot
3. Bot was kicked from the server

Re-invite: Developer Portal → OAuth2 → URL Generator → scopes: bot + applications.commands
`)
    console.error(err.message)
  }

  if (DISCORD_CHECKIN_CHANNEL_ID) {
    await setupAutoCheckin()
  } else {
    console.log('DISCORD_CHECKIN_CHANNEL_ID not set — use /start-checkin manually, or set the channel ID for auto check-in.')
  }
})

client.on('interactionCreate', async interaction => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== 'start-checkin') return

    try {
      const type = interaction.options.getString('type')
      const focused = interaction.options.getFocused(true)
      if (focused.name !== 'event') return interaction.respond([])

      const drafts = await listDraftEvents(type ?? undefined)
      const query = (focused.value ?? '').toLowerCase()
      const choices = drafts
        .filter(event => `${event.type} ${event.event_date}`.toLowerCase().includes(query))
        .slice(0, 25)
        .map(event => ({ name: `${event.type} · ${event.event_date}`, value: event.id }))

      return interaction.respond(choices)
    } catch (err) {
      console.error(err)
      return interaction.respond([])
    }
  }

  if (!interaction.isChatInputCommand() || !interaction.inGuild()) return

  if (interaction.commandName === 'start-checkin') {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Officers only.', ephemeral: true })
    }

    const type = interaction.options.getString('type', true)
    const eventId = interaction.options.getString('event')

    let event = null
    if (eventId) {
      event = await getDraftEventById(eventId)
      if (!event) {
        return interaction.reply({ content: 'That draft event was not found.', ephemeral: true })
      }
      if (event.type !== type) {
        return interaction.reply({
          content: `That event is **${event.type}**, not **${type}**. Pick a matching event or leave **event** blank.`,
          ephemeral: true,
        })
      }
    } else {
      event = await resolveDraftEventByType(type)
      if (!event) {
        return interaction.reply({
          content: `No draft **${type}** event found. Create one on the website first (Events → Create Draft).`,
          ephemeral: true,
        })
      }
    }

    await openCheckin(event, interaction.channel)

    const pickedNote = event.event_date === todayDate()
      ? 'today\'s draft'
      : `latest draft (${event.event_date})`

    return interaction.reply({
      content: `Check-in opened for **${event.type} · ${event.event_date}** (${pickedNote}). Attendance syncs to the website.`,
      ephemeral: true,
    })
  }

  if (interaction.commandName === 'stop-checkin') {
    if (!isOfficer(interaction.member)) {
      return interaction.reply({ content: 'Officers only.', ephemeral: true })
    }
    await supabase.from('events').update({ checkin_open: false }).eq('checkin_open', true)
    return interaction.reply({ content: 'Check-in closed.', ephemeral: true })
  }

  if (interaction.commandName === 'checkin-status') {
    const event = await getOpenCheckinEvent()
    if (!event) return interaction.reply({ content: 'No check-in is open.', ephemeral: true })
    return interaction.reply({
      content: `Open check-in: **${event.type} · ${event.event_date}**`,
      ephemeral: true,
    })
  }
})

async function handleReaction(reaction, user, added) {
  if (user.bot) return
  if (reaction.emoji.name !== CHECKIN_EMOJI && reaction.emoji.toString() !== CHECKIN_EMOJI) return

  const message = reaction.message.partial ? await reaction.message.fetch() : reaction.message
  const event = await getOpenCheckinEvent()
  if (!event || event.checkin_message_id !== message.id) return

  const guild = client.guilds.cache.get(DISCORD_GUILD_ID)
  const guildMember = await guild.members.fetch(user.id).catch(() => null)
  if (!guildMember) return

  if (added) {
    const member = await upsertMemberFromDiscord(guildMember)
    await markPresent(event.id, member.id)
    console.log(`Checked in: ${member.name} (${user.id})`)
  } else {
    const member = await findMemberByDiscordId(user.id)
    if (member) await removePresent(event.id, member.id)
    console.log(`Removed check-in: ${user.id}`)
  }
}

client.on('messageReactionAdd', async (reaction, user) => {
  try { await handleReaction(reaction, user, true) } catch (e) { console.error(e) }
})

client.on('messageReactionRemove', async (reaction, user) => {
  try { await handleReaction(reaction, user, false) } catch (e) { console.error(e) }
})

client.on('error', err => console.error('Discord client error:', err.message))

client.login(DISCORD_BOT_TOKEN)
