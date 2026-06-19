'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { EventBanner } from '@/components/EventBanner'
import { useEvent } from '@/hooks/useEvent'
import {
  DESIGNATED_PAGES,
  DESIGNATED_SLOT_COUNT,
  DesignatedAssignment,
  generateDesignatedAssignments,
  replaceDesignatedSlot,
} from '@/lib/designated'
import { errorMessage } from '@/lib/errors'
import { loadRotationContext } from '@/lib/history'
import { REWARD_LABELS } from '@/lib/reward-defaults'
import { updateHeldTurns } from '@/lib/rotation'
import { useSupabase } from '@/lib/supabase'
import { Member, RewardType } from '@/lib/types'

type DbRow = {
  member_id: string
  item_type: RewardType
  slot_index: number
  members: { name: string } | { name: string }[] | null
}

const ROTATABLE: RewardType[] = ['puppet', 'light_dark', 'time_space']

function memberName(row: DbRow): string {
  const m = row.members
  if (!m) return 'Unknown'
  return Array.isArray(m) ? m[0]?.name ?? 'Unknown' : m.name
}

export default function DesignatedPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = useSupabase()
  const { event, loading: eventLoading, locked, designatedLocked, generated } = useEvent(id)
  const [eligible, setEligible] = useState<Member[]>([])
  const [rows, setRows] = useState<DbRow[]>([])
  const [busy, setBusy] = useState(false)
  const [rotationNote, setRotationNote] = useState<string | null>(null)

  async function loadEligible() {
    if (!supabase) return
    const { data: parts } = await supabase
      .from('event_participants')
      .select('member_id')
      .eq('event_id', id)
      .eq('is_online', true)
      .eq('no_gold', false)
    const ids = (parts ?? []).map(p => p.member_id)
    if (!ids.length) {
      setEligible([])
      return
    }
    const { data: members } = await supabase
      .from('members')
      .select('*')
      .in('id', ids)
      .eq('status', 'active')
      .eq('is_auction_eligible', true)
    setEligible(members ?? [])
  }

  async function loadDesignated() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('designated_bidders')
      .select('member_id,item_type,slot_index,members(name)')
      .eq('event_id', id)
      .order('item_type')
      .order('slot_index')
    if (error) return alert(error.message)
    setRows((data ?? []) as DbRow[])
  }

  async function loadAll() {
    await Promise.all([loadEligible(), loadDesignated()])
  }

  useEffect(() => { loadAll() }, [supabase, id])

  useEffect(() => {
    if (generated) router.replace(`/events/${id}/results`)
  }, [generated, id, router])

  useEffect(() => {
    if (!supabase || generated || designatedLocked) return
    loadRotationContext(supabase, id)
      .then(ctx => {
        if (ctx.isFirstGeneratedEvent) {
          setRotationNote(
            'Head of rotation queue fills designated slots (5 puppet, 5 pages L/D, 5 pages T/S).',
          )
        } else {
          setRotationNote(
            'Next in rotation for each item type fills designated slots. Declined / no gold → next in line.',
          )
        }
      })
      .catch(() => setRotationNote(null))
  }, [supabase, id, generated, designatedLocked])

  const discordText = useMemo(() => {
    const lines: string[] = []
    for (const type of ROTATABLE) {
      const typeRows = rows.filter(r => r.item_type === type)
      if (!typeRows.length) continue
      lines.push(`**${REWARD_LABELS[type]} — designated**`)
      for (const row of typeRows) {
        lines.push(`${memberName(row)} (slot ${row.slot_index + 1})`)
      }
      lines.push('')
    }
    return lines.join('\n').trim()
  }, [rows])

  async function copyDiscord() {
    await navigator.clipboard.writeText(discordText)
    alert('Copied')
  }

  async function persistAssignments(assignments: DesignatedAssignment[]) {
    if (!supabase) return
    const { error: delError } = await supabase.from('designated_bidders').delete().eq('event_id', id)
    if (delError) throw delError
    if (!assignments.length) return
    const { error } = await supabase.from('designated_bidders').insert(
      assignments.map(a => ({
        event_id: id,
        member_id: a.memberId,
        item_type: a.itemType,
        slot_index: a.slotIndex,
      })),
    )
    if (error) throw error
  }

  async function generateList() {
    if (!supabase || !event || !locked || designatedLocked || busy) return
    if (!eligible.length) return alert('No eligible online members.')
    setBusy(true)
    try {
      const ctx = await loadRotationContext(supabase, id)
      const [{ data: attendance }, { data: participants }] = await Promise.all([
        supabase.from('attendance').select('member_id').eq('event_id', id),
        supabase.from('event_participants').select('member_id,is_online,no_gold').eq('event_id', id),
      ])
      const attendedMemberIds = new Set((attendance ?? []).map(a => a.member_id))
      const noGoldMemberIds = new Set(
        (participants ?? []).filter(p => p.no_gold).map(p => p.member_id),
      )
      const heldTurns = updateHeldTurns(ctx, attendedMemberIds, noGoldMemberIds)
      const assignments = generateDesignatedAssignments(
        id,
        event.type,
        eligible,
        ctx,
        heldTurns,
      )
      await persistAssignments(assignments)
      await loadDesignated()
    } catch (e: unknown) {
      alert(errorMessage(e, 'Could not generate designated list'))
    } finally {
      setBusy(false)
    }
  }

  async function declineSlot(itemType: RewardType, slotIndex: number, removedMemberId: string) {
    if (!supabase || !event || !locked || designatedLocked || busy) return
    setBusy(true)
    try {
      const ctx = await loadRotationContext(supabase, id)
      const [{ data: attendance }, { data: participants }] = await Promise.all([
        supabase.from('attendance').select('member_id').eq('event_id', id),
        supabase.from('event_participants').select('member_id,is_online,no_gold').eq('event_id', id),
      ])
      const attendedMemberIds = new Set((attendance ?? []).map(a => a.member_id))
      const noGoldMemberIds = new Set(
        (participants ?? []).filter(p => p.no_gold).map(p => p.member_id),
      )
      const heldTurns = updateHeldTurns(ctx, attendedMemberIds, noGoldMemberIds)

      const current = rows.map(r => ({
        memberId: r.member_id,
        itemType: r.item_type,
        slotIndex: r.slot_index,
      }))

      const replacement = replaceDesignatedSlot(
        id,
        event.type,
        itemType,
        slotIndex,
        eligible,
        ctx,
        heldTurns,
        current,
        removedMemberId,
      )

      if (!replacement) {
        alert('No one else in rotation for this slot. Remove the row or regenerate the list.')
        return
      }

      const { error } = await supabase
        .from('designated_bidders')
        .update({ member_id: replacement })
        .eq('event_id', id)
        .eq('item_type', itemType)
        .eq('slot_index', slotIndex)
      if (error) throw error
      await loadDesignated()
    } catch (e: unknown) {
      alert(errorMessage(e, 'Could not replace designated bidder'))
    } finally {
      setBusy(false)
    }
  }

  async function lockDesignated() {
    if (!supabase || !event || !locked || designatedLocked || busy) return
    if (!rows.length) return alert('Generate the designated list first.')
    const expected = ROTATABLE.reduce((sum, type) => sum + DESIGNATED_SLOT_COUNT[type], 0)
    if (rows.length < expected) {
      return alert(`Designated list is incomplete (${rows.length}/${expected} slots). Regenerate the list.`)
    }
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('events')
        .update({ status: 'designated' })
        .eq('id', id)
        .eq('status', 'locked')
        .select()
        .single()
      if (error || !data) throw new Error('Could not lock designated list.')
      router.push(`/events/${id}/rewards`)
    } catch (e: unknown) {
      alert(errorMessage(e, 'Could not lock designated list'))
    } finally {
      setBusy(false)
    }
  }

  if (eventLoading || !supabase) return <main><p className="muted">Loading…</p></main>
  if (!event) return <main><p>Event not found.</p></main>
  if (event.status === 'draft') {
    return <main>
      <h1>Designated Bidders</h1>
      <EventBanner event={event} />
      <section className="card">
        <p className="muted">Lock the auction pool first.</p>
        <Link className="btn" href={`/events/${id}/eligibility`}>Auction Pool</Link>
      </section>
    </main>
  }

  const canEdit = locked && !designatedLocked

  return <main>
    <h1>Designated Bidders</h1>
    <EventBanner event={event} />
    <section className="card">
      <p>
        Generate the designated list <b>before bidding</b> (no item totals needed).
        Head of rotation for each item fills{' '}
        <b>5 puppet</b>, <b>{DESIGNATED_PAGES} pages L/D</b>, and <b>{DESIGNATED_PAGES} pages T/S</b>.
        Decline / no gold pulls the next person in rotation for that item only.
      </p>
      <p className="muted">
        After locking, enter item totals when bidding starts, then generate the full board.
        Designated members are excluded from normal slots for the same item.
      </p>
      {rotationNote && <p className="muted">{rotationNote}</p>}
      <p>Eligible online members: <b>{eligible.length}</b></p>
      <p>Designated slots filled: <b>{rows.length}</b> / {ROTATABLE.reduce((s, t) => s + DESIGNATED_SLOT_COUNT[t], 0)}</p>

      <div className="row">
        {canEdit && (
          <button onClick={generateList} disabled={busy || !eligible.length}>
            {rows.length ? 'Regenerate designated list' : 'Generate designated list'}
          </button>
        )}
        {rows.length > 0 && (
          <button className="secondary" onClick={copyDiscord} disabled={!discordText}>Copy for Discord</button>
        )}
        {canEdit && rows.length > 0 && (
          <button onClick={lockDesignated} disabled={busy}>Lock designated list</button>
        )}
        {designatedLocked && (
          <Link className="btn" href={`/events/${id}/rewards`}>Enter item totals</Link>
        )}
        {designatedLocked && (
          <Link className="btn secondary" href={`/events/${id}/generate`}>Generate board</Link>
        )}
        {canEdit && (
          <Link className="btn secondary" href={`/events/${id}/eligibility`}>View locked pool</Link>
        )}
      </div>
    </section>

    {ROTATABLE.map(itemType => {
      const typeRows = rows.filter(r => r.item_type === itemType)
      const slotCount = DESIGNATED_SLOT_COUNT[itemType]
      return (
        <section key={itemType} className="card">
          <h2>{REWARD_LABELS[itemType]} — designated ({slotCount} slots)</h2>
          {!typeRows.length && <p className="muted">Not generated yet.</p>}
          {typeRows.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Slot</th>
                  <th>Member</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {typeRows.map(row => (
                  <tr key={`${row.item_type}-${row.slot_index}`}>
                    <td>{row.slot_index + 1}</td>
                    <td>{memberName(row)}</td>
                    {canEdit && (
                      <td>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => declineSlot(row.item_type, row.slot_index, row.member_id)}
                        >
                          Declined / no gold
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )
    })}
  </main>
}
