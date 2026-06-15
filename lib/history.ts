import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EMPTY_ROTATION_CONTEXT,
  parseDueMembers,
  parseHeldTurns,
  ROTATABLE_TYPES,
  RotationContext,
} from './rotation'
import { EventType, RewardType } from './types'

/** Load rotation context for allocation (cohort, sit-out, holds, lifetime). */
export async function loadRotationContext(
  supabase: SupabaseClient,
  currentEventId: string,
): Promise<RotationContext> {
  const { data: pastEvents, error: eventsError } = await supabase
    .from('events')
    .select('id, event_date, created_at, type')
    .eq('status', 'generated')
    .neq('id', currentEventId)
    .order('event_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (eventsError) throw eventsError
  if (!pastEvents?.length) return EMPTY_ROTATION_CONTEXT

  const firstGeneratedEvent = pastEvents[0]
  const lastEvent = pastEvents[pastEvents.length - 1]
  const eventIds = pastEvents.map(e => e.id)

  const [
    { data: allocations, error: allocError },
    { data: priorParticipants, error: partError },
    { data: lastRun, error: runError },
  ] = await Promise.all([
    supabase
      .from('auction_allocations')
      .select('event_id, member_id, item_type')
      .in('event_id', eventIds)
      .not('member_id', 'is', null),
    supabase
      .from('event_participants')
      .select('member_id, event_id')
      .in('event_id', eventIds)
      .eq('is_online', true)
      .eq('no_gold', false),
    supabase
      .from('allocation_runs')
      .select('due_for_next, held_turns')
      .eq('event_id', lastEvent.id)
      .order('generated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (allocError) throw allocError
  if (partError) throw partError
  if (runError) throw runError

  const priorPoolMemberIds = new Set((priorParticipants ?? []).map(p => p.member_id))
  const lastEventWinners = new Map<RewardType, Set<string>>()
  const allTimeCounts = new Map<string, Map<RewardType, number>>()

  for (const type of ROTATABLE_TYPES) {
    lastEventWinners.set(type, new Set())
  }

  for (const row of allocations ?? []) {
    const itemType = row.item_type as RewardType
    if (!allTimeCounts.has(row.member_id)) allTimeCounts.set(row.member_id, new Map())
    const counts = allTimeCounts.get(row.member_id)!
    counts.set(itemType, (counts.get(itemType) ?? 0) + 1)

    if (row.event_id === lastEvent.id && ROTATABLE_TYPES.includes(itemType)) {
      lastEventWinners.get(itemType)!.add(row.member_id)
    }
  }

  return {
    isFirstGeneratedEvent: false,
    firstGeneratedEventId: firstGeneratedEvent.id,
    priorPoolMemberIds,
    lastEventWinners,
    allTimeCounts,
    heldTurns: parseHeldTurns(lastRun?.held_turns),
    previousDue: parseDueMembers(lastRun?.due_for_next),
    lastEventId: lastEvent.id,
    lastEventDate: lastEvent.event_date,
    lastEventType: lastEvent.type as EventType,
  }
}

/** @deprecated Use loadRotationContext — kept for brief compatibility. */
export async function loadRotationHistory(
  supabase: SupabaseClient,
  currentEventId: string,
) {
  const ctx = await loadRotationContext(supabase, currentEventId)
  const lastEventByMember = new Map<string, Set<RewardType>>()
  for (const [type, winners] of ctx.lastEventWinners) {
    for (const memberId of winners) {
      if (!lastEventByMember.has(memberId)) lastEventByMember.set(memberId, new Set())
      lastEventByMember.get(memberId)!.add(type)
    }
  }
  return {
    lastEventByMember,
    allTimeCounts: ctx.allTimeCounts,
    lastEventId: ctx.lastEventId,
    lastEventDate: ctx.lastEventDate,
    lastEventType: ctx.lastEventType,
  }
}
