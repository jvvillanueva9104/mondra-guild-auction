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
  DISCORD_CHECKIN_CHANNEL_ID: CHECKIN_CHANNEL_RAW,
  DISCORD_BOARD_CHANNEL_ID: BOARD_CHANNEL_RAW,
  DISCORD_OFFICER_ROLE_ID,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CHECKIN_EMOJI = '✅',
} = process.env

function envId(value) {
  if (!value) return undefined
  return value.trim().split(/\s+#/)[0].trim() || undefined
}

const DISCORD_CHECKIN_CHANNEL_ID = envId(CHECKIN_CHANNEL_RAW)
const DISCORD_BOARD_CHANNEL_ID = envId(BOARD_CHANNEL_RAW)

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

/** Prevent duplicate Discord posts while Supabase save is in flight or retrying. */
const checkinOpenInFlight = new Set()
/** eventId → { messageId, channelId } when Discord post succeeded but DB write failed */
const pendingCheckinSaves = new Map()
let realtimeSubscribed = false

async function saveCheckinMessage(eventId, message) {
  const { data, error } = await supabase.from('events').update({
    checkin_open: true,
    checkin_message_id: message.id,
    checkin_channel_id: message.channel.id,
  }).eq('id', eventId).is('checkin_message_id', null).select('id').maybeSingle()

  if (error) {
    pendingCheckinSaves.set(eventId, { messageId: message.id, channelId: message.channel.id })
    throw error
  }
  if (!data) {
    console.log(`Check-in message already linked for event ${eventId} — skipping duplicate save.`)
    return
  }
  pendingCheckinSaves.delete(eventId)
}

async function retryPendingCheckinSaves() {
  for (const [eventId, pending] of [...pendingCheckinSaves.entries()]) {
    const { error } = await supabase.from('events').update({
      checkin_open: true,
      checkin_message_id: pending.messageId,
      checkin_channel_id: pending.channelId,
    }).eq('id', eventId)
    if (!error) {
      pendingCheckinSaves.delete(eventId)
      console.log(`Recovered check-in message link for event ${eventId}`)
    }
  }
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
    const byDiscord = await findMemberByDiscordId(discordId)
    if (byDiscord) return byDiscord
    throw new Error(
      `Roster name "${name}" is already taken. Ask an officer to use a unique Discord nickname.`,
    )
  }
  if (error) throw error
  return data
}

async function checkInFromDiscordUser(guildMember, eventId) {
  const member = await upsertMemberFromDiscord(guildMember)
  await markPresent(eventId, member.id)
  return member
}

/** Re-process everyone who already reacted — fixes missed events and re-add after roster delete. */
async function syncCheckinReactions(event, { logEach = false } = {}) {
  if (!event?.checkin_message_id || !event?.checkin_channel_id) return 0

  const guild = client.guilds.cache.get(DISCORD_GUILD_ID)
  if (!guild) return 0

  const channel = await guild.channels.fetch(event.checkin_channel_id).catch(() => null)
  if (!channel?.isTextBased()) return 0

  const message = await channel.messages.fetch(event.checkin_message_id).catch(() => null)
  if (!message) return 0

  const reaction = message.reactions.cache.find(
    r => r.emoji.name === CHECKIN_EMOJI || r.emoji.toString() === CHECKIN_EMOJI,
  )
  if (!reaction) return 0

  const users = await reaction.users.fetch()
  let synced = 0

  for (const user of users.values()) {
    if (user.bot) continue
    const guildMember = await guild.members.fetch(user.id).catch(() => null)
    if (!guildMember) continue

    try {
      const member = await checkInFromDiscordUser(guildMember, event.id)
      synced++
      if (logEach) console.log(`Synced check-in: ${member.name} (${user.id})`)
    } catch (e) {
      console.error(`Check-in sync failed for ${user.id}:`, e.message)
    }
  }

  return synced
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

  await saveCheckinMessage(event.id, message)

  const updated = { ...event, checkin_message_id: message.id, checkin_channel_id: message.channel.id }
  await syncCheckinReactions(updated, { logEach: true })

  return message
}

function logDiscordSendError(context, err) {
  const hint = err.code === 50001 || /missing access/i.test(err.message)
    ? ' — grant the bot View Channel, Send Messages, and Embed Links in the board channel'
    : ''
  console.error(`${context}: ${err.message}${hint}`)
}

const DISCORD_MAX_EMBED_DESC = 4096
const DISCORD_MAX_MENTIONS = 50
const boardPostInFlight = new Set()

/** Only auto-post board announcements for tonight's event — not old test/history rows. */
function isBoardPostEligible(eventRecord) {
  if (!eventRecord?.event_date) return true
  return eventRecord.event_date === todayDate()
}

function memberRowName(row) {
  const m = row.members
  if (!m) return 'Unknown'
  return Array.isArray(m) ? m[0]?.name ?? 'Unknown' : m.name
}

function memberRowDiscordId(row) {
  const m = row.members
  if (!m) return null
  const member = Array.isArray(m) ? m[0] : m
  return member?.discord_id ?? null
}

function formatMemberLine(index, name, discordId) {
  if (discordId) return `${index}. <@${discordId}>`
  return `${index}. ${name}`
}

function collectMentionIds(rows, getDiscordId = memberRowDiscordId) {
  const ids = []
  for (const row of rows) {
    const discordId = getDiscordId(row)
    if (discordId) ids.push(discordId)
  }
  return [...new Set(ids)]
}

async function getBoardChannel() {
  if (!DISCORD_BOARD_CHANNEL_ID) return null
  const guild = client.guilds.cache.get(DISCORD_GUILD_ID)
  if (!guild) {
    console.error('Guild not found in cache for board channel lookup')
    return null
  }
  const channel = await guild.channels.fetch(DISCORD_BOARD_CHANNEL_ID).catch(err => {
    console.error('Could not fetch board channel:', err.message)
    return null
  })
  if (!channel?.isTextBased()) {
    console.error('DISCORD_BOARD_CHANNEL_ID is not a text channel the bot can use')
    return null
  }
  return channel
}

async function loadDesignatedRows(eventId) {
  const { data, error } = await supabase
    .from('designated_bidders')
    .select('bidder_index, member_id, members(name, discord_id)')
    .eq('event_id', eventId)
    .order('bidder_index')
  if (error) throw error
  return data ?? []
}

async function loadNormalBidderRows(eventId) {
  const { data, error } = await supabase
    .from('auction_allocations')
    .select('member_id, members(name, discord_id)')
    .eq('event_id', eventId)
    .eq('is_designated', false)
    .not('member_id', 'is', null)
  if (error) throw error

  const byId = new Map()
  for (const row of data ?? []) {
    if (!row.member_id || byId.has(row.member_id)) continue
    byId.set(row.member_id, row)
  }

  return [...byId.values()].sort((a, b) =>
    memberRowName(a).localeCompare(memberRowName(b), undefined, { sensitivity: 'base' }),
  )
}

async function sendBoardMessages(channel, payloads) {
  const sent = []
  for (const payload of payloads) {
    const message = await channel.send(payload)
    sent.push(message)
  }
  return sent
}

async function postDesignatedBidders(eventRecord) {
  if (eventRecord.status !== 'designated' && eventRecord.status !== 'generated') return
  if (eventRecord.designated_discord_message_id) return
  if (!isBoardPostEligible(eventRecord)) return

  const lockKey = `designated:${eventRecord.id}`
  if (boardPostInFlight.has(lockKey)) return
  boardPostInFlight.add(lockKey)

  try {
    const channel = await getBoardChannel()
    if (!channel) {
      console.log(
        `Designated list locked (${eventRecord.type} · ${eventRecord.event_date}) — ` +
        'set DISCORD_BOARD_CHANNEL_ID to auto-post.',
      )
      return
    }

    const { data: fresh, error } = await supabase
      .from('events')
      .select('id, type, event_date, status, designated_discord_message_id')
      .eq('id', eventRecord.id)
      .single()
    if (error) throw error
    if (!fresh || fresh.designated_discord_message_id) return
    if (!isBoardPostEligible(fresh)) return

    const rows = await loadDesignatedRows(eventRecord.id)
    if (!rows.length) {
      console.log(`No designated bidders to post for event ${eventRecord.id}`)
      return
    }

    const lines = rows.map((row, i) =>
      formatMemberLine(i + 1, memberRowName(row), memberRowDiscordId(row)),
    )
    const mentionIds = collectMentionIds(rows)
    const header =
      `**Designated Bidders · ${eventRecord.type} · ${eventRecord.event_date}**\n\n` +
      'Each bidder receives **1 puppet**, **1 L/D page**, and **1 T/S page** ' +
      '(extra pages at the end of the board).\n\n'

    const embed = new EmbedBuilder()
      .setColor(0x8b0000)
      .setDescription(`${header}${lines.join('\n')}`.slice(0, DISCORD_MAX_EMBED_DESC))

    const message = await channel.send({
      embeds: [embed],
      allowedMentions: { users: mentionIds },
    })

    const { data: saved, error: saveError } = await supabase.from('events').update({
      designated_discord_message_id: message.id,
      board_discord_channel_id: channel.id,
    }).eq('id', eventRecord.id).is('designated_discord_message_id', null).select('id').maybeSingle()

    if (saveError) throw saveError
    if (!saved) {
      console.log(`Designated post already linked for event ${eventRecord.id} — skipping duplicate save.`)
      return
    }

    console.log(`Posted designated bidders for ${eventRecord.type} · ${eventRecord.event_date} in #${channel.name}`)
  } catch (err) {
    logDiscordSendError(
      `Designated board post failed for ${eventRecord.type} · ${eventRecord.event_date}`,
      err,
    )
  } finally {
    boardPostInFlight.delete(lockKey)
  }
}

function formatMentionOnly(row) {
  const discordId = memberRowDiscordId(row)
  if (discordId) return `<@${discordId}>`
  return memberRowName(row)
}

/** Group mentions into readable lines; split across messages when limits hit. */
function buildMentionPayloads(rows, header, continuedHeader) {
  const mentionIds = collectMentionIds(rows)
  const parts = rows.map(formatMentionOnly)
  const mentionLines = []
  for (let i = 0; i < parts.length; i += 6) {
    mentionLines.push(parts.slice(i, i + 6).join(' '))
  }

  const payloads = []
  let lineIndex = 0
  let chunkLines = []
  let chunkIds = new Set()
  let chunkLen = 0
  let chunkIndex = 0

  function flush() {
    if (!chunkLines.length) return
    const prefix = chunkIndex === 0 ? header : continuedHeader
    const embed = new EmbedBuilder()
      .setColor(0x8b0000)
      .setDescription(`${prefix}${chunkLines.join('\n')}`.slice(0, DISCORD_MAX_EMBED_DESC))
    payloads.push({
      embeds: [embed],
      allowedMentions: { users: [...chunkIds] },
    })
    chunkIndex++
    chunkLines = []
    chunkIds = new Set()
    chunkLen = 0
  }

  while (lineIndex < mentionLines.length) {
    const line = mentionLines[lineIndex]
    const lineLen = line.length + 1
    const lineIds = parts
      .slice(lineIndex * 6, lineIndex * 6 + 6)
      .map(part => part.match(/^<@(\d+)>$/)?.[1])
      .filter(Boolean)

    const newIds = lineIds.filter(id => !chunkIds.has(id))
    const mentionBlocked = chunkIds.size + newIds.length > DISCORD_MAX_MENTIONS

    if (chunkLines.length > 0 && (chunkLen + lineLen > DISCORD_MAX_EMBED_DESC - header.length || mentionBlocked)) {
      flush()
    }

    chunkLines.push(line)
    chunkLen += lineLen
    for (const id of lineIds) chunkIds.add(id)
    lineIndex++
  }

  flush()
  return payloads
}

async function postNormalBidders(eventRecord) {
  if (eventRecord.status !== 'generated') return
  if (eventRecord.bidders_discord_message_id) return
  if (!isBoardPostEligible(eventRecord)) return

  const lockKey = `bidders:${eventRecord.id}`
  if (boardPostInFlight.has(lockKey)) return
  boardPostInFlight.add(lockKey)

  try {
    const channel = await getBoardChannel()
    if (!channel) {
      console.log(
        `Board generated (${eventRecord.type} · ${eventRecord.event_date}) — ` +
        'set DISCORD_BOARD_CHANNEL_ID to auto-post bidders.',
      )
      return
    }

    const { data: fresh, error } = await supabase
      .from('events')
      .select('id, type, event_date, status, bidders_discord_message_id')
      .eq('id', eventRecord.id)
      .single()
    if (error) throw error
    if (!fresh || fresh.bidders_discord_message_id) return
    if (!isBoardPostEligible(fresh)) return

    const rows = await loadNormalBidderRows(eventRecord.id)
    if (!rows.length) {
      console.log(`No normal bidders to post for event ${eventRecord.id}`)
      return
    }

    const header =
      `**Auction Bidders · ${eventRecord.type} · ${eventRecord.event_date}**\n\n` +
      `${rows.length} member${rows.length === 1 ? '' : 's'} bidding on tonight's normal board:\n\n`
    const continuedHeader =
      `**Auction Bidders · ${eventRecord.type} · ${eventRecord.event_date}** _(continued)_\n\n`

    const payloads = buildMentionPayloads(rows, header, continuedHeader)
    const messages = await sendBoardMessages(channel, payloads)
    const firstMessage = messages[0]

    const { data: saved, error: saveError } = await supabase.from('events').update({
      bidders_discord_message_id: firstMessage.id,
      board_discord_channel_id: channel.id,
    }).eq('id', eventRecord.id).is('bidders_discord_message_id', null).select('id').maybeSingle()

    if (saveError) throw saveError
    if (!saved) {
      console.log(`Bidders post already linked for event ${eventRecord.id} — skipping duplicate save.`)
      return
    }

    console.log(
      `Posted normal bidders for ${eventRecord.type} · ${eventRecord.event_date} in #${channel.name}` +
      (messages.length > 1 ? ` (${messages.length} messages)` : ''),
    )
  } catch (err) {
    logDiscordSendError(
      `Normal bidders post failed for ${eventRecord.type} · ${eventRecord.event_date}`,
      err,
    )
  } finally {
    boardPostInFlight.delete(lockKey)
  }
}

async function catchUpBoardPosts() {
  if (!DISCORD_BOARD_CHANNEL_ID) return

  const today = todayDate()

  const { data: designatedPending, error: designatedError } = await supabase
    .from('events')
    .select('id, type, event_date, status, designated_discord_message_id, bidders_discord_message_id')
    .in('status', ['designated', 'generated'])
    .eq('event_date', today)
    .is('designated_discord_message_id', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (designatedError) throw designatedError
  if (designatedPending) await postDesignatedBidders(designatedPending)

  const { data: biddersPending, error: biddersError } = await supabase
    .from('events')
    .select('id, type, event_date, status, designated_discord_message_id, bidders_discord_message_id')
    .eq('status', 'generated')
    .eq('event_date', today)
    .is('bidders_discord_message_id', null)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (biddersError) throw biddersError
  if (biddersPending) {
    if (!biddersPending.designated_discord_message_id) {
      await postDesignatedBidders(biddersPending)
    }
    await postNormalBidders(biddersPending)
  }
}

function startBoardPostWatch() {
  return supabase
    .channel('board-posts')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'events' }, payload => {
      const row = payload.new
      if (!row?.id || !isBoardPostEligible(row)) return
      if (row.status === 'designated') {
        postDesignatedBidders(row).catch(err => console.error('Designated post failed:', err.message))
      }
      if (row.status === 'generated') {
        postDesignatedBidders(row).catch(err => console.error('Designated post failed:', err.message))
        postNormalBidders(row).catch(err => console.error('Bidders post failed:', err.message))
      }
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        console.log('Watching for designated / generated events (board posts)…')
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.error(`Board post Realtime ${status}:`, err?.message ?? 'unknown error')
      }
    })
}

async function setupAutoBoardPosts() {
  if (!DISCORD_BOARD_CHANNEL_ID) {
    console.log('DISCORD_BOARD_CHANNEL_ID not set — designated / bidder lists will not auto-post.')
    return
  }

  const channel = await getBoardChannel()
  if (!channel) {
    console.error(
      'DISCORD_BOARD_CHANNEL_ID is set but the bot cannot access that channel — ' +
      'check the ID and bot permissions (View Channel, Send Messages, Embed Links).',
    )
    return
  }

  console.log(`Board announcements channel: #${channel.name}`)

  const perms = channel.permissionsFor(client.user)
  if (!perms?.has(PermissionsBitField.Flags.ViewChannel)) {
    console.error('Bot cannot view the board channel — check channel permissions.')
    return
  }
  if (!perms?.has(PermissionsBitField.Flags.SendMessages)) {
    console.error(
      'Bot cannot send messages in the board channel — allow Send Messages + Embed Links for the bot role.',
    )
    return
  }

  try {
    await catchUpBoardPosts()
  } catch (err) {
    console.error('Board post catch-up failed:', err.message)
  }

  startBoardPostWatch()
  console.log('Auto board posts active (designated on lock, bidders on generate).')
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
  if (checkinOpenInFlight.has(eventRecord.id)) return

  const today = todayDate()
  if (eventRecord.event_date !== today) {
    console.log(
      `Skipping auto check-in for ${eventRecord.type} · ${eventRecord.event_date} — not today (${today}). ` +
      'Delete old drafts on the website or use /start-checkin to open manually.',
    )
    return
  }

  // Claim before any await — Realtime + polling can fire together on INSERT.
  checkinOpenInFlight.add(eventRecord.id)

  try {
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
  } catch (err) {
    console.error(`Auto check-in failed for ${eventRecord.type} · ${eventRecord.event_date}:`, err.message)
    if (pendingCheckinSaves.has(eventRecord.id)) {
      console.error('Discord message was posted but Supabase save failed — will retry linking, not repost.')
    }
  } finally {
    checkinOpenInFlight.delete(eventRecord.id)
  }
}

async function catchUpDraftCheckins() {
  if (!DISCORD_CHECKIN_CHANNEL_ID) return

  await retryPendingCheckinSaves()

  const today = todayDate()
  const { data, error } = await supabase
    .from('events')
    .select('id, type, event_date, status, checkin_message_id')
    .eq('status', 'draft')
    .is('checkin_message_id', null)
    .eq('event_date', today)
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
        realtimeSubscribed = true
        console.log('Watching for new draft events (Supabase Realtime)…')
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        realtimeSubscribed = false
        console.error(`Realtime ${status}:`, err?.message ?? 'unknown error')
        console.error('Run supabase/migrations/004_realtime_events.sql in Supabase SQL Editor.')
      } else if (status !== 'CLOSED') {
        console.log('Realtime status:', status)
      }
    })
}

function startDraftEventPolling(intervalMs = 15000) {
  return setInterval(() => {
    retryPendingCheckinSaves().catch(err => console.error('Check-in save retry failed:', err.message))
    if (DISCORD_BOARD_CHANNEL_ID) {
      catchUpBoardPosts().catch(err => console.error('Board post catch-up failed:', err.message))
    }
    if (!realtimeSubscribed) {
      catchUpDraftCheckins().catch(err => console.error('Check-in poll failed:', err.message))
    }
    getOpenCheckinEvent()
      .then(event => event ? syncCheckinReactions(event) : 0)
      .catch(err => console.error('Reaction sync failed:', err.message))
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
    const openEvent = await getOpenCheckinEvent()
    if (openEvent) {
      const n = await syncCheckinReactions(openEvent, { logEach: true })
      if (n > 0) console.log(`Startup: synced ${n} check-in reaction(s).`)
    }
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

  await setupAutoBoardPosts()
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
    const member = await checkInFromDiscordUser(guildMember, event.id)
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
