'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { EventBanner } from '@/components/EventBanner'
import { useEvent } from '@/hooks/useEvent'
import { errorMessage } from '@/lib/errors'
import { generateAllocations } from '@/lib/allocation'
import { DesignatedAssignment } from '@/lib/designated'
import { loadRotationContext } from '@/lib/history'
import { consumeHeldTurns, serializeHeldTurns, updateHeldTurns } from '@/lib/rotation'
import { REWARD_LABELS } from '@/lib/reward-defaults'
import { useSupabase } from '@/lib/supabase'
import { EventReward, Member, RewardType } from '@/lib/types'

export default function GeneratePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const supabase = useSupabase()
  const { event, loading: eventLoading, designatedLocked, generated } = useEvent(id)
  const [eligible, setEligible] = useState<Member[]>([])
  const [rewards, setRewards] = useState<EventReward[]>([])
  const [designated, setDesignated] = useState<DesignatedAssignment[]>([])
  const [generating, setGenerating] = useState(false)
  const [rotationNote, setRotationNote] = useState<string | null>(null)
  const total = rewards.reduce((s, r) => s + r.quantity, 0)

  async function load() {
    if (!supabase) return
    const [{ data: parts }, { data: rewardsData }, { data: designatedData }] = await Promise.all([
      supabase
        .from('event_participants')
        .select('member_id')
        .eq('event_id', id)
        .eq('is_online', true)
        .eq('no_gold', false),
      supabase.from('event_rewards').select('reward_type,quantity,per_member_cap').eq('event_id', id),
      supabase.from('designated_bidders').select('member_id,item_type,slot_index').eq('event_id', id),
    ])
    const ids = (parts ?? []).map(p => p.member_id)
    if (ids.length) {
      const { data: members } = await supabase
        .from('members')
        .select('*')
        .in('id', ids)
        .eq('status', 'active')
        .eq('is_auction_eligible', true)
      setEligible(members ?? [])
    } else {
      setEligible([])
    }
    setRewards((rewardsData ?? []) as EventReward[])
    setDesignated((designatedData ?? []).map(row => ({
      memberId: row.member_id,
      itemType: row.item_type as RewardType,
      slotIndex: row.slot_index,
    })))
  }

  useEffect(() => { load() }, [supabase, id])

  useEffect(() => {
    if (generated) router.replace(`/events/${id}/results`)
  }, [generated, id, router])

  useEffect(() => {
    if (!event || generated) return
    if (event.status === 'locked') router.replace(`/events/${id}/designated`)
    if (event.status === 'draft') router.replace(`/events/${id}/eligibility`)
  }, [event, generated, id, router])

  useEffect(() => {
    if (!supabase || generated) return
    loadRotationContext(supabase, id)
      .then(ctx => {
        if (ctx.isFirstGeneratedEvent) {
          setRotationNote(
            'Normal slots use random order among online bidders. Designated list is already locked.',
          )
        } else {
          const label = ctx.lastEventType ? `${ctx.lastEventType} · ${ctx.lastEventDate}` : ctx.lastEventDate
          setRotationNote(
            `Normal slots follow rotation v3 (${label}). Designated bidders are on the last pages per item.`,
          )
        }
      })
      .catch(() => setRotationNote(null))
  }, [supabase, id, generated])

  async function generate() {
    if (!supabase || !designatedLocked || generating || !event) return
    setGenerating(true)
    try {
      if (!designated.length) throw new Error('Designated list is missing. Go back and lock designated bidders.')

      const ctx = await loadRotationContext(supabase, id)

      const [{ data: attendance }, { data: participants }] = await Promise.all([
        supabase.from('attendance').select('member_id').eq('event_id', id),
        supabase.from('event_participants').select('member_id,is_online,no_gold').eq('event_id', id),
      ])

      const attendedMemberIds = new Set((attendance ?? []).map(a => a.member_id))
      const noGoldMemberIds = new Set(
        (participants ?? []).filter(p => p.no_gold).map(p => p.member_id),
      )
      const eligibleIds = new Set(eligible.map(m => m.id))

      let heldTurns = updateHeldTurns(ctx, attendedMemberIds, noGoldMemberIds)

      const { allocations, dueForNext } = generateAllocations(
        id,
        event.type,
        eligible,
        rewards,
        ctx,
        heldTurns,
        designated,
      )

      const heldJson = serializeHeldTurns(consumeHeldTurns(heldTurns, eligibleIds))

      const { error: delAllocError } = await supabase.from('auction_allocations').delete().eq('event_id', id)
      if (delAllocError) throw delAllocError
      const { error: delRunError } = await supabase.from('allocation_runs').delete().eq('event_id', id)
      if (delRunError) throw delRunError
      const { data: run, error: runError } = await supabase
        .from('allocation_runs')
        .insert({
          event_id: id,
          seed: id,
          algorithm_version: 'rotation-v3-cohort-designated',
          due_for_next: dueForNext,
          held_turns: heldJson,
        })
        .select()
        .single()
      if (runError) throw runError
      const rows = allocations.map(a => ({
        ...a,
        allocation_run_id: run.id,
        is_designated: a.is_designated ?? false,
      }))
      const { error } = await supabase.from('auction_allocations').insert(rows)
      if (error) throw error
      const { data, error: eventError } = await supabase
        .from('events')
        .update({ status: 'generated' })
        .eq('id', id)
        .eq('status', 'designated')
        .select()
        .single()
      if (eventError || !data) throw new Error('Could not finalize event.')
      router.push(`/events/${id}/results`)
    } catch (e: unknown) {
      alert(errorMessage(e, 'Generation failed'))
    } finally {
      setGenerating(false)
    }
  }

  const limits = (Object.keys(REWARD_LABELS) as RewardType[])
    .map(type => {
      const row = rewards.find(r => r.reward_type === type)
      if (!row?.quantity) return null
      const cap = type === 'puppet' ? 1 : (row.per_member_cap ?? '—')
      return `${REWARD_LABELS[type]}: max ${cap} per player`
    })
    .filter(Boolean)

  if (eventLoading || !supabase) return <main><p className="muted">Loading…</p></main>
  if (!event) return <main><p>Event not found.</p></main>
  if (generated) return <main><p className="muted">Redirecting to results…</p></main>
  if (!designatedLocked) return <main><p className="muted">Redirecting…</p></main>

  return <main>
    <h1>Generate Allocation</h1>
    <EventBanner event={event} />
    <section className="card">
      <p className="muted">
        Item totals are entered when bidding starts. Designated bidders are already locked on the last pages.
      </p>
      <p>Eligible online members: <b>{eligible.length}</b></p>
      <p>Designated slots locked: <b>{designated.length}</b></p>
      <p>Total reward slots: <b>{total}</b></p>
      {limits.length > 0 && (
        <p>Per-player limits this event: {limits.join(' · ')}</p>
      )}
      {rotationNote && <p className="muted">{rotationNote}</p>}
      <div className="row">
        <button onClick={generate} disabled={generating || eligible.length === 0 || total === 0}>
          {generating ? 'Generating…' : 'Generate Allocation'}
        </button>
        {total === 0 && (
          <Link className="btn" href={`/events/${id}/rewards`}>Enter Item Totals</Link>
        )}
        <Link className="btn secondary" href={`/events/${id}/designated`}>View designated list</Link>
      </div>
    </section>
  </main>
}
