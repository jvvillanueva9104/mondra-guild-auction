'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { EventBanner } from '@/components/EventBanner'
import { useEvent } from '@/hooks/useEvent'
import { useSupabase } from '@/lib/supabase'
import { Member } from '@/lib/types'

type Row = Member & { is_online: boolean }

export default function EligibilityPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = useSupabase()
  const { event, loading: eventLoading, editable } = useEvent(id)
  const [rows, setRows] = useState<Row[]>([])

  async function load() {
    if (!supabase) return
    const { data: attendance } = await supabase.from('attendance').select('member_id').eq('event_id', id)
    const ids = (attendance ?? []).map(a => a.member_id)
    if (!ids.length) { setRows([]); return }
    const [{ data: members }, { data: parts }] = await Promise.all([
      supabase.from('members').select('*').in('id', ids).eq('status', 'active').eq('is_auction_eligible', true).order('name'),
      supabase.from('event_participants').select('member_id,is_online').eq('event_id', id),
    ])
    const map = new Map((parts ?? []).map(p => [p.member_id, p.is_online]))
    setRows((members ?? []).map(m => ({ ...m, is_online: map.get(m.id) ?? false })))
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

    const { data: rewardRows, error: rewardError } = await supabase
      .from('event_rewards')
      .select('quantity')
      .eq('event_id', id)
    if (rewardError) return alert(rewardError.message)
    const rewardTotal = (rewardRows ?? []).reduce((sum, row) => sum + row.quantity, 0)
    if (rewardTotal === 0) {
      return alert('Enter item totals before locking. Open Item Totals and save what the guild earned tonight.')
    }

    await supabase.from('event_participants').delete().eq('event_id', id)
    const insertRows = rows.map(r => ({ event_id: id, member_id: r.id, is_online: r.is_online }))
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
    router.push(`/events/${id}/generate`)
  }

  if (eventLoading || !supabase) return <main><p className="muted">Loading…</p></main>
  if (!event) return <main><p>Event not found.</p></main>

  if (event.status === 'generated') return <main><p className="muted">Redirecting to results…</p></main>

  return <main>
    <h1>Auction Eligible Pool</h1>
    <EventBanner event={event} />
    <section className="card">
      <p>Only members marked present who are online here enter the allocation engine.</p>
      {!rows.length && <p className="muted">No attendees yet. Go back and mark attendance first.</p>}
      <table>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td>
                <input
                  type="checkbox"
                  checked={r.is_online}
                  disabled={!editable}
                  onChange={e => setRows(rows.map(x => x.id === r.id ? { ...x, is_online: e.target.checked } : x))}
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
          <Link className="btn" href={`/events/${id}/generate`}>Go to Generate</Link>
        )}
      </div>
    </section>
  </main>
}
