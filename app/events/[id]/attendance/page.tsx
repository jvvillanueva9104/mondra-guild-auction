'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { EventBanner } from '@/components/EventBanner'
import { useEvent } from '@/hooks/useEvent'
import { useSupabase } from '@/lib/supabase'
import { Member } from '@/lib/types'

export default function AttendancePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = useSupabase()
  const { event, loading: eventLoading, editable } = useEvent(id)
  const [members, setMembers] = useState<Member[]>([])
  const [present, setPresent] = useState<Set<string>>(new Set())
  const presentHeaderRef = useRef<HTMLInputElement>(null)

  const allPresent = members.length > 0 && members.every(m => present.has(m.id))
  const somePresent = members.some(m => present.has(m.id))

  async function load() {
    if (!supabase) return
    const [{ data: ms }, { data: att }] = await Promise.all([
      supabase.from('members').select('*').eq('status', 'active').order('name'),
      supabase.from('attendance').select('member_id').eq('event_id', id),
    ])
    setMembers(ms ?? [])
    setPresent(new Set((att ?? []).map(a => a.member_id)))
  }

  useEffect(() => { load() }, [supabase, id])

  useEffect(() => {
    if (event?.status === 'generated') router.replace(`/events/${id}/results`)
  }, [event?.status, id, router])

  useEffect(() => {
    if (presentHeaderRef.current) {
      presentHeaderRef.current.indeterminate = somePresent && !allPresent
    }
  }, [somePresent, allPresent])

  async function save() {
    if (!supabase || !editable) return
    await supabase.from('attendance').delete().eq('event_id', id)
    const rows = [...present].map(member_id => ({ event_id: id, member_id }))
    if (rows.length) {
      const { error } = await supabase.from('attendance').insert(rows)
      if (error) return alert(error.message)
    }
    alert('Attendance saved')
  }

  function toggle(mid: string) {
    if (!editable) return
    const next = new Set(present)
    next.has(mid) ? next.delete(mid) : next.add(mid)
    setPresent(next)
  }

  function toggleAll(checked: boolean) {
    if (!editable) return
    setPresent(checked ? new Set(members.map(m => m.id)) : new Set())
  }

  if (eventLoading || !supabase) return <main><p className="muted">Loading…</p></main>
  if (!event) return <main><p>Event not found.</p></main>

  if (event.status === 'generated') return <main><p className="muted">Redirecting to results…</p></main>

  return <main>
    <h1>Attendance</h1>
    <EventBanner event={event} />
    <section className="card">
      <p>Tick members who attended this event, or use Discord check-in before raid night.</p>
      {editable && (
        <p className="muted">
          Check-in usually opens automatically in Discord when the draft was created. Manual fallback:{' '}
          <code>/start-checkin type:{event.type}</code>
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>
              <label className="check-all-label">
                <input
                  ref={presentHeaderRef}
                  type="checkbox"
                  checked={allPresent}
                  disabled={!editable || !members.length}
                  onChange={e => toggleAll(e.target.checked)}
                />
                Present
              </label>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>
                <input
                  type="checkbox"
                  checked={present.has(m.id)}
                  disabled={!editable}
                  onChange={() => toggle(m.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <br />
      <div className="row">
        {editable && <button onClick={save}>Save Attendance</button>}
        {editable && (
          <Link className="btn" href={`/events/${id}/eligibility`}>Continue to Auction Pool</Link>
        )}
        {editable && (
          <Link className="btn secondary" href={`/events/${id}/rewards`}>Item Totals</Link>
        )}
        {event.status === 'locked' && (
          <Link className="btn" href={`/events/${id}/designated`}>Designated bidders</Link>
        )}
        {event.status === 'designated' && (
          <Link className="btn" href={`/events/${id}/generate`}>Generate board</Link>
        )}
      </div>
    </section>
  </main>
}
