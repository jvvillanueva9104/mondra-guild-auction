'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { EventBanner } from '@/components/EventBanner'
import { RewardEditor, RewardFormRow } from '@/components/RewardEditor'
import { useEvent } from '@/hooks/useEvent'
import { emptyRewards } from '@/lib/reward-defaults'
import { useSupabase } from '@/lib/supabase'
import { RewardType } from '@/lib/types'

function rowsFromDb(
  type: 'EO' | 'GL',
  rows: { reward_type: RewardType; quantity: number; per_member_cap: number | null }[],
): Record<RewardType, RewardFormRow> {
  const base = emptyRewards(type)
  for (const row of rows) {
    base[row.reward_type] = {
      quantity: row.quantity,
      per_member_cap: row.per_member_cap ?? base[row.reward_type].per_member_cap,
    }
  }
  return base
}

export default function RewardsPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = useSupabase()
  const { event, loading: eventLoading } = useEvent(id)
  const canEdit = event?.status !== 'generated'
  const [rewards, setRewards] = useState<Record<RewardType, RewardFormRow> | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    if (!supabase || !event) return
    const { data, error } = await supabase
      .from('event_rewards')
      .select('reward_type,quantity,per_member_cap')
      .eq('event_id', id)
    if (error) return alert(error.message)
    setRewards(rowsFromDb(event.type, data ?? []))
  }

  useEffect(() => { load() }, [supabase, id, event])

  async function save() {
    if (!supabase || !canEdit || !rewards || !event) return
    setSaving(true)
    const rows = (Object.keys(rewards) as RewardType[]).map(reward_type => ({
      event_id: id,
      reward_type,
      quantity: rewards[reward_type].quantity,
      per_member_cap: rewards[reward_type].per_member_cap,
    }))
    const { error } = await supabase.from('event_rewards').upsert(rows, { onConflict: 'event_id,reward_type' })
    setSaving(false)
    if (error) return alert(error.message)
    alert('Item totals saved')
  }

  const total = rewards
    ? (Object.values(rewards) as RewardFormRow[]).reduce((sum, row) => sum + row.quantity, 0)
    : 0

  if (eventLoading || !supabase) return <main><p className="muted">Loading…</p></main>
  if (!event) return <main><p>Event not found.</p></main>

  return <main>
    <h1>Item Totals</h1>
    <EventBanner event={event} />
    <section className="card">
      <p>
        Enter how many items the guild earned tonight. You can save this after the event — totals are not needed for check-in.
      </p>
      <p className="muted">
        Per-player limits can be adjusted here if tonight&apos;s ranking differs from the usual defaults.
      </p>
      {rewards ? (
        <>
          <RewardEditor rewards={rewards} onChange={setRewards} disabled={!canEdit} />
          <p className="muted">Total slots: {total}</p>
        </>
      ) : (
        <p className="muted">Loading items…</p>
      )}
      <br />
      <div className="row">
        {canEdit && rewards && (
          <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Item Totals'}</button>
        )}
        <Link className="btn secondary" href={`/events/${id}/attendance`}>Attendance</Link>
        <Link className="btn secondary" href={`/events/${id}/eligibility`}>Auction Pool</Link>
        {event.status === 'locked' && (
          <Link className="btn" href={`/events/${id}/generate`}>Generate</Link>
        )}
      </div>
    </section>
  </main>
}
