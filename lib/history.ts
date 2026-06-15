import type { SupabaseClient } from '@supabase/supabase-js'
import { EMPTY_ROTATION_HISTORY, RotationHistory } from './rotation'
import { EventType, RewardType } from './types'

/** Load assignment history across all EO + GL events for unified rotation. */
export async function loadRotationHistory(
  supabase: SupabaseClient,
  currentEventId: string,
): Promise<RotationHistory> {
  const { data: pastEvents, error: eventsError } = await supabase
    .from('events')
    .select('id, event_date, created_at, type')
    .eq('status', 'generated')
    .neq('id', currentEventId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false })

  if (eventsError) throw eventsError
  if (!pastEvents?.length) return EMPTY_ROTATION_HISTORY

  const lastEvent = pastEvents[0]
  const eventIds = pastEvents.map(e => e.id)

  const { data: allocations, error: allocError } = await supabase
    .from('auction_allocations')
    .select('event_id, member_id, item_type')
    .in('event_id', eventIds)
    .not('member_id', 'is', null)

  if (allocError) throw allocError

  const lastEventByMember = new Map<string, Set<RewardType>>()
  const allTimeCounts = new Map<string, Map<RewardType, number>>()

  for (const row of allocations ?? []) {
    const itemType = row.item_type as RewardType
    if (!allTimeCounts.has(row.member_id)) allTimeCounts.set(row.member_id, new Map())
    const counts = allTimeCounts.get(row.member_id)!
    counts.set(itemType, (counts.get(itemType) ?? 0) + 1)

    if (row.event_id === lastEvent.id) {
      if (!lastEventByMember.has(row.member_id)) lastEventByMember.set(row.member_id, new Set())
      lastEventByMember.get(row.member_id)!.add(itemType)
    }
  }

  return {
    lastEventByMember,
    allTimeCounts,
    lastEventId: lastEvent.id,
    lastEventDate: lastEvent.event_date,
    lastEventType: lastEvent.type as EventType,
  }
}
