'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { EventBanner } from '@/components/EventBanner'
import { useEvent } from '@/hooks/useEvent'
import { useSupabase } from '@/lib/supabase'
import { Member } from '@/lib/types'

type Row = Member & { is_online: boolean; no_gold: boolean }

export default function EligibilityPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = useSupabase()
  const { event, loading: eventLoading, editable } = useEvent(id)
  const [rows, setRows] = useState<Row[]>([])
  const onlineHeaderRef = useRef<HTMLInputElement>(null)

  const allOnline = rows.length > 0 && rows.every(r => r.is_online)
  const someOnline = rows.some(r => r.is_online)

  useEffect(() => {
    if (onlineHeaderRef.current) {
      onlineHeaderRef.current.indeterminate = someOnline && !allOnline
    }
  }, [someOnline, allOnline])

  function setAllOnline(checked: boolean) {
    if (!editable) return
    setRows(rows.map(r => ({ ...r, is_online: checked, no_gold: checked ? false : r.no_gold })))
  }

  function setOnline(memberId: string, checked: boolean) {
    setRows(rows.map(r =>
      r.id === memberId
        ? { ...r, is_online: checked, no_gold: checked ? false : r.no_gold }
        : r,
    ))
  }

  function setNoGold(memberId: string, checked: boolean) {
    setRows(rows.map(r =>
      r.id === memberId
        ? { ...r, no_gold: checked, is_online: checked ? false : r.is_online }
        : r,
    ))
  }

  async function load() {
    if (!supabase) return
    const { data: attendance } = await supabase.from('attendance').select('member_id').eq('event_id', id)
    const ids = (attendance ?? []).map(a => a.member_id)
    if (!ids.length) { setRows([]); return }
    const [{ data: members }, { data: parts }] = await Promise.all([
      supabase.from('members').select('*').in('id', ids).eq('status', 'active').eq('is_auction_eligible', true).order('name'),
      supabase.from('event_participants').select('member_id,is_online,no_gold').eq('event_id', id),
    ])
    const map = new Map((parts ?? []).map(p => [p.member_id, p]))
    setRows((members ?? []).map(m => {
      const part = map.get(m.id)
      return {
        ...m,
        is_online: part?.is_online ?? false,
        no_gold: part?.no_gold ?? false,
      }
    }))
  }

  useEffect(() => { load() }, [supabase, id])

  useEffect(() => {
    if (event?.status === 'generated') router.replace(`/events/${id}/results`)
  }, [event?.status, id, router])

  async function lockEvent() {
    if (!supabase || !editable) return
    if (!rows.length) return alert('Mark attendance first — no eligible members found.')
    const onlineCount = rows.filter(r => r.is_online).length
    if (onlineCount === 0) return alert('Select at least one online member before locking.')

    await supabase.from('event_participants').delete().eq('event_id', id)
    const insertRows = rows.map(r => ({
      event_id: id,
      member_id: r.id,
      is_online: r.is_online,
      no_gold: r.no_gold,
    }))
    const { error: partError } = await supabase.from('event_participants').insert(insertRows)
    if (partError) return alert(partError.message)

    const { data, error } = await supabase
      .from('events')
      .update({ status: 'locked' })
      .eq('id', id)
      .eq('status', 'draft')
      .select()
      .single()
    if (error || !data) return alert('Could not lock event. It may already be locked or generated.')
    router.push(`/events/${id}/designated`)
  }

  if (eventLoading || !supabase) return <main><p className="muted">Loading…</p></main>
  if (!event) return <main><p>Event not found.</p></main>

  if (event.status === 'generated') return <main><p className="muted">Redirecting to results…</p></main>

  return <main>
    <h1>Auction Eligible Pool</h1>
    <EventBanner event={event} />
    <section className="card">
      <p>
        Mark who is bidding tonight. <b>Online</b> enters the allocation board.
        <b> No gold / passing</b> means present but not bidding — no queue penalty.
        Only one of Online or No gold can be checked.
      </p>
      {!rows.length && <p className="muted">No attendees yet. Go back and mark attendance first.</p>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>
              <label className="check-all-label">
                <input
                  ref={onlineHeaderRef}
                  type="checkbox"
                  checked={allOnline}
                  disabled={!editable || !rows.length}
                  onChange={e => setAllOnline(e.target.checked)}
                />
                Online
              </label>
            </th>
            <th>No gold</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>
                <input
                  type="checkbox"
                  checked={r.is_online}
                  disabled={!editable}
                  onChange={e => setOnline(r.id, e.target.checked)}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={r.no_gold}
                  disabled={!editable}
                  onChange={e => setNoGold(r.id, e.target.checked)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <br />
      <div className="row">
        {editable && <button onClick={lockEvent}>Lock Event &amp; Continue</button>}
        {editable && (
          <Link className="btn secondary" href={`/events/${id}/rewards`}>Item Totals</Link>
        )}
        {editable && (
          <Link className="btn secondary" href={`/events/${id}/attendance`}>Back to Attendance</Link>
        )}
        {event.status === 'locked' && (
          <Link className="btn" href={`/events/${id}/designated`}>Designated Bidders</Link>
        )}
        {event.status === 'designated' && (
          <Link className="btn" href={`/events/${id}/generate`}>Generate board</Link>
        )}
      </div>
    </section>
  </main>
}
