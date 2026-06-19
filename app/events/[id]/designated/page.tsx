'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { EventBanner } from '@/components/EventBanner'
import { useEvent } from '@/hooks/useEvent'
import {
  DESIGNATED_BIDDER_COUNT,
  DESIGNATED_PAGES,
  DesignatedBidder,
  generateDesignatedBidders,
  replaceDesignatedBidder,
} from '@/lib/designated'
import { errorMessage } from '@/lib/errors'
import { loadRotationContext } from '@/lib/history'
import { updateHeldTurns } from '@/lib/rotation'
import { useSupabase } from '@/lib/supabase'
import { Member } from '@/lib/types'

type DbRow = {
  member_id: string
  bidder_index: number
  members: { name: string } | { name: string }[] | null
}

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
      .select('member_id,bidder_index,members(name)')
      .eq('event_id', id)
      .order('bidder_index')
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
            'Next five in rotation become designated bidders — each gets 1 puppet, 1 L/D page, and 1 T/S page.',
          )
        } else {
          setRotationNote(
            'Head of puppet rotation picks five designated bidders. Declined / no gold → next in line.',
          )
        }
      })
      .catch(() => setRotationNote(null))
  }, [supabase, id, generated, designatedLocked])

  const discordText = useMemo(() => {
    if (!rows.length) return ''
    const lines = ['**Designated bidders** (each: 1 puppet · 1 L/D page · 1 T/S page)', '']
    for (const row of rows) {
      lines.push(`${row.bidder_index + 1}. ${memberName(row)}`)
    }
    return lines.join('\n').trim()
  }, [rows])

  async function copyDiscord() {
    await navigator.clipboard.writeText(discordText)
    alert('Copied')
  }

  async function persistBidders(bidders: DesignatedBidder[]) {
    if (!supabase) return
    const { error: delError } = await supabase.from('designated_bidders').delete().eq('event_id', id)
    if (delError) throw delError
    if (!bidders.length) return
    const { error } = await supabase.from('designated_bidders').insert(
      bidders.map(b => ({
        event_id: id,
        member_id: b.memberId,
        bidder_index: b.bidderIndex,
      })),
    )
    if (error) throw error
  }

  async function loadHeldTurns() {
    if (!supabase) throw new Error('Not connected')
    const ctx = await loadRotationContext(supabase, id)
    const [{ data: attendance }, { data: participants }] = await Promise.all([
      supabase.from('attendance').select('member_id').eq('event_id', id),
      supabase.from('event_participants').select('member_id,is_online,no_gold').eq('event_id', id),
    ])
    const attendedMemberIds = new Set((attendance ?? []).map(a => a.member_id))
    const noGoldMemberIds = new Set(
      (participants ?? []).filter(p => p.no_gold).map(p => p.member_id),
    )
    return updateHeldTurns(ctx, attendedMemberIds, noGoldMemberIds)
  }

  async function generateList() {
    if (!supabase || !event || !locked || designatedLocked || busy) return
    if (!eligible.length) return alert('No eligible online members.')
    setBusy(true)
    try {
      const ctx = await loadRotationContext(supabase, id)
      const heldTurns = await loadHeldTurns()
      const bidders = generateDesignatedBidders(id, eligible, ctx, heldTurns)
      await persistBidders(bidders)
      await loadDesignated()
    } catch (e: unknown) {
      alert(errorMessage(e, 'Could not generate designated list'))
    } finally {
      setBusy(false)
    }
  }

  async function declineBidder(bidderIndex: number, removedMemberId: string) {
    if (!supabase || !event || !locked || designatedLocked || busy) return
    setBusy(true)
    try {
      const ctx = await loadRotationContext(supabase, id)
      const heldTurns = await loadHeldTurns()
      const current = rows.map(r => ({
        memberId: r.member_id,
        bidderIndex: r.bidder_index,
      }))

      const replacement = replaceDesignatedBidder(
        id,
        bidderIndex,
        eligible,
        ctx,
        heldTurns,
        current,
        removedMemberId,
      )

      if (!replacement) {
        alert('No one else in rotation. Add more online bidders or regenerate the list.')
        return
      }

      const { error } = await supabase
        .from('designated_bidders')
        .update({ member_id: replacement })
        .eq('event_id', id)
        .eq('bidder_index', bidderIndex)
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
    if (rows.length < DESIGNATED_BIDDER_COUNT) {
      return alert(
        `Need ${DESIGNATED_BIDDER_COUNT} designated bidders (${rows.length}/${DESIGNATED_BIDDER_COUNT}). ` +
        'Add more online bidders to the pool, regenerate, then lock.',
      )
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
  const byIndex = new Map(rows.map(r => [r.bidder_index, r]))
  const slotsIncomplete = rows.length > 0 && rows.length < DESIGNATED_BIDDER_COUNT

  return <main>
    <h1>Designated Bidders</h1>
    <EventBanner event={event} />
    <section className="card">
      <p>
        Pick <b>{DESIGNATED_BIDDER_COUNT} designated bidders</b> before bidding (no item totals needed).
        Each person gets <b>1 puppet</b>, <b>1 page of L/D</b>, and <b>1 page of T/S</b> on the last pages of the board.
        Decline / no gold pulls the next person in rotation.
      </p>
      <p className="muted">
        After locking, enter item totals when bidding starts, then generate the full board.
        Designated bidders are excluded from normal slots for puppet, L/D, and T/S.
      </p>
      {rotationNote && <p className="muted">{rotationNote}</p>}
      <p>Eligible online members: <b>{eligible.length}</b></p>
      <p>Designated bidders: <b>{rows.length}</b> / {DESIGNATED_BIDDER_COUNT}</p>
      {slotsIncomplete && (
        <p className="muted">
          Not enough online bidders to fill all five slots. Lock is available only when all {DESIGNATED_BIDDER_COUNT} are assigned.
        </p>
      )}

      <div className="row">
        {canEdit && (
          <button onClick={generateList} disabled={busy || !eligible.length}>
            {rows.length ? 'Regenerate list' : 'Generate designated list'}
          </button>
        )}
        {rows.length > 0 && (
          <button className="secondary" onClick={copyDiscord} disabled={!discordText}>Copy for Discord</button>
        )}
        {canEdit && rows.length >= DESIGNATED_BIDDER_COUNT && (
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

    <section className="card">
      <h2>Designated bidders ({rows.length}/{DESIGNATED_BIDDER_COUNT})</h2>
      <p className="muted">Each row: 1 puppet shard · 1 page ({DESIGNATED_PAGES} pages total) L/D · 1 page T/S</p>
      {!rows.length && <p className="muted">Not generated yet.</p>}
      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Member</th>
              <th>Covers</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: DESIGNATED_BIDDER_COUNT }, (_, bidderIndex) => {
              const row = byIndex.get(bidderIndex)
              return (
                <tr key={bidderIndex}>
                  <td>{bidderIndex + 1}</td>
                  <td className={row ? undefined : 'muted'}>{row ? memberName(row) : '—'}</td>
                  <td className="muted">Puppet · L/D page · T/S page</td>
                  {canEdit && (
                    <td>
                      {row ? (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => declineBidder(bidderIndex, row.member_id)}
                        >
                          Declined / no gold
                        </button>
                      ) : null}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  </main>
}
