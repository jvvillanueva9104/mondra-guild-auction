'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { eventOpenHref } from '@/lib/event-routes'
import { emptyRewards } from '@/lib/reward-defaults'
import { useSupabase } from '@/lib/supabase'
import { Event, RewardType } from '@/lib/types'

export default function Home() {
  const supabase = useSupabase()
  const [events, setEvents] = useState<Event[]>([])
  const [type, setType] = useState<'EO'|'GL'>('EO')
  const [eventDate, setEventDate] = useState('')

  useEffect(() => {
    setEventDate(new Date().toISOString().slice(0, 10))
  }, [])

  async function load() {
    if (!supabase) return
    const { data } = await supabase.from('events').select('*').order('created_at', { ascending: false })
    setEvents(data ?? [])
  }

  useEffect(() => { load() }, [supabase])

  async function createEvent() {
    if (!supabase) return

    const { data: existingDrafts, error: lookupError } = await supabase
      .from('events')
      .select('id, type, event_date, status')
      .eq('status', 'draft')
      .eq('event_date', eventDate)

    if (lookupError) return alert(lookupError.message)

    if (existingDrafts?.length) {
      const list = existingDrafts.map(e => `${e.type} · ${e.event_date}`).join(', ')
      const ok = confirm(
        `A draft already exists for ${eventDate}: ${list}.\n\n` +
        'Creating another draft will post a new Discord check-in and stop recording reactions on the old one. ' +
        'Delete the extra draft instead if it was a mistake.\n\n' +
        'Create this draft anyway?',
      )
      if (!ok) return
    }

    const { data: event, error } = await supabase.from('events').insert({ type, event_date: eventDate }).select().single()
    if (error) return alert(error.message)
    const defaults = emptyRewards(type)
    const rows = (Object.keys(defaults) as RewardType[]).map(reward_type => ({
      event_id: event.id,
      reward_type,
      quantity: defaults[reward_type].quantity,
      per_member_cap: defaults[reward_type].per_member_cap,
    }))
    const { error: rewardError } = await supabase.from('event_rewards').insert(rows)
    if (rewardError) return alert(rewardError.message)
    load()
  }

  async function deleteEvent(event: Event) {
    if (!supabase) return
    const label = `${event.type} · ${event.event_date} (${event.status})`
    if (!confirm(`Delete event ${label}? This cannot be undone.`)) return
    const { error } = await supabase.from('events').delete().eq('id', event.id)
    if (error) return alert(error.message)
    load()
  }

  if (!supabase) return <main><p className="muted">Loading…</p></main>

  return <main>
    <h1>Guild Auction Planner</h1>
    <section className="card">
      <h2>Create Event</h2>
      <div className="row">
        <select value={type} onChange={e => setType(e.target.value as 'EO'|'GL')}>
          <option value="EO">EO (Sunday)</option>
          <option value="GL">Guild League (Tue / Thu)</option>
        </select>
        <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} />
        <button onClick={createEvent}>Create Draft</button>
      </div>
      <p className="muted">
        Create the event before raid night for Discord check-in. Item totals are entered later on the event&apos;s Item Totals page.
        If the bot is running with a check-in channel configured, Discord check-in opens automatically when you create the draft.
        Only create <b>one draft per raid night</b> — a second draft replaces the active Discord check-in.
      </p>
    </section>
    <section className="card">
      <h2>Events</h2>
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {events.map(e => (
            <tr key={e.id}>
              <td>{e.event_date}</td>
              <td>{e.type}</td>
              <td>{e.status}</td>
              <td>
                <div className="row table-actions">
                  <Link className="btn" href={eventOpenHref(e)}>Open</Link>
                  <button type="button" className="danger" onClick={() => deleteEvent(e)}>Delete</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!events.length && <p className="muted">No events yet.</p>}
    </section>
  </main>
}
