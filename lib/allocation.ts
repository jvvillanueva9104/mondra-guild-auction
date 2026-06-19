import {
  computeDueForNext,
  rotationOrder,
  ROTATABLE_TYPES,
  RotationContext,
  splitPassMembers,
} from './rotation'
import { DEFAULT_PER_MEMBER_CAPS } from './reward-defaults'
import { buildDesignatedSlotMap, designatedMemberIds, designatedReserveForCount, DesignatedBidder } from './designated'
import { Allocation, EventReward, EventType, Member, RewardType } from './types'

export { seededShuffle } from './shuffle'

export const ROWS_PER_PAGE = 4
export const REWARD_ORDER: RewardType[] = ['puppet', 'mvp', 'light_dark', 'time_space']

export type GenerateResult = {
  allocations: Allocation[]
  dueForNext: Record<string, string | null>
}

export function buildRewardSlots(rewards: EventReward[]): RewardType[] {
  return REWARD_ORDER.flatMap(type => Array(rewards.find(r => r.reward_type === type)?.quantity ?? 0).fill(type))
}

export function rewardQuantity(rewards: EventReward[], type: RewardType): number {
  return rewards.find(r => r.reward_type === type)?.quantity ?? 0
}

/** Per-player limit for this event — from event setup, with EO/GL defaults as fallback. */
export function rewardPerMemberCap(
  rewards: EventReward[],
  type: RewardType,
  eventType: EventType,
): number | undefined {
  const row = rewards.find(r => r.reward_type === type)
  if (row?.per_member_cap != null && row.per_member_cap > 0) return row.per_member_cap
  const fallback = DEFAULT_PER_MEMBER_CAPS[eventType][type]
  return fallback > 0 ? fallback : undefined
}

function slotMeta(slotIndex: number) {
  return {
    slot_index: slotIndex,
    page_number: Math.floor(slotIndex / ROWS_PER_PAGE) + 1,
    row_number: (slotIndex % ROWS_PER_PAGE) + 1,
  }
}

function makeAllocation(
  eventId: string,
  itemType: RewardType,
  slotIndex: number,
  memberId: string | null,
  isDesignated = false,
): Allocation {
  return {
    event_id: eventId,
    member_id: memberId,
    item_type: itemType,
    is_designated: isDesignated,
    ...slotMeta(slotIndex),
  }
}

function assignDesignatedTail(
  eventId: string,
  itemType: RewardType,
  startSlotIndex: number,
  designatedCount: number,
  designatedSlots: Map<number, string>,
): Allocation[] {
  return Array.from({ length: designatedCount }, (_, i) => {
    const memberId = designatedSlots.get(i) ?? null
    return makeAllocation(eventId, itemType, startSlotIndex + i, memberId, true)
  })
}

function assignOneEachFirst(
  eventId: string,
  members: Member[],
  itemType: RewardType,
  startSlotIndex: number,
  count: number,
  perMemberCap = 1,
): Allocation[] {
  const out: Allocation[] = []
  let slot = startSlotIndex
  let remaining = count

  for (const member of members) {
    if (remaining <= 0) break
    const give = Math.min(perMemberCap, remaining)
    for (let i = 0; i < give; i++) {
      out.push(makeAllocation(eventId, itemType, slot, member.id))
      slot++
      remaining--
    }
  }

  while (remaining > 0) {
    out.push(makeAllocation(eventId, itemType, slot, null))
    slot++
    remaining--
  }

  return out
}

function assignFreeForAll(
  eventId: string,
  itemType: RewardType,
  startSlotIndex: number,
  count: number,
): Allocation[] {
  return Array.from({ length: count }, (_, i) =>
    makeAllocation(eventId, itemType, startSlotIndex + i, null),
  )
}

function assignNextFreeSlots(
  assignments: Map<number, string | null>,
  start: number,
  end: number,
  memberId: string,
  amount: number,
) {
  let assigned = 0
  for (let s = start; s < end && assigned < amount; s++) {
    if (assignments.get(s) !== null) continue
    assignments.set(s, memberId)
    assigned++
  }
}

function assignPageGroupedForMembers(
  eventId: string,
  members: Member[],
  itemType: RewardType,
  startSlotIndex: number,
  count: number,
  perMemberCap?: number,
): Allocation[] {
  const end = startSlotIndex + count
  const assignments = new Map<number, string | null>()

  for (let s = startSlotIndex; s < end; s++) {
    assignments.set(s, null)
  }

  if (members.length === 0) {
    return [...assignments.entries()]
      .sort(([a], [b]) => a - b)
      .map(([slotIndex, memberId]) => makeAllocation(eventId, itemType, slotIndex, memberId))
  }

  const perMember = perMemberCap !== undefined
    ? Math.min(perMemberCap, Math.floor(count / members.length))
    : Math.floor(count / members.length)

  if (perMember > 0) {
    for (const member of members) {
      assignNextFreeSlots(assignments, startSlotIndex, end, member.id, perMember)
    }
  }

  return [...assignments.entries()]
    .sort(([a], [b]) => a - b)
    .map(([slotIndex, memberId]) => makeAllocation(eventId, itemType, slotIndex, memberId))
}

/**
 * Puppet / feathers with sit-out pass 1, overflow pass 2, remainder FFA.
 */
function assignRotatingItem(
  eventId: string,
  orderedMembers: Member[],
  itemType: RewardType,
  startSlotIndex: number,
  count: number,
  perMemberCap: number | undefined,
  lastWinners: Set<string>,
  pageGrouped: boolean,
): Allocation[] {
  const { pass1, pass2 } = splitPassMembers(orderedMembers, lastWinners)

  if (pageGrouped) {
    const pass1Allocs = assignPageGroupedForMembers(
      eventId, pass1, itemType, startSlotIndex, count, perMemberCap,
    )
    let filled = pass1Allocs.filter(a => a.member_id !== null).length
    let remaining = count - filled
    if (remaining <= 0) return pass1Allocs

    const pass2Allocs = assignPageGroupedForMembers(
      eventId, pass2, itemType, startSlotIndex + filled, remaining, perMemberCap,
    )
    const merged = [...pass1Allocs]
    for (const alloc of pass2Allocs) {
      const idx = merged.findIndex(a => a.slot_index === alloc.slot_index)
      if (idx >= 0) merged[idx] = alloc
    }
    filled = merged.filter(a => a.member_id !== null).length
    remaining = count - filled
    if (remaining <= 0) return merged

    const ffaStart = startSlotIndex + filled
    for (let i = 0; i < remaining; i++) {
      const idx = merged.findIndex(a => a.slot_index === ffaStart + i)
      if (idx >= 0) merged[idx] = makeAllocation(eventId, itemType, ffaStart + i, null)
    }
    return merged
  }

  const pass1Allocs = assignOneEachFirst(
    eventId, pass1, itemType, startSlotIndex, count, perMemberCap ?? 1,
  )
  let filled = pass1Allocs.filter(a => a.member_id !== null).length
  let remaining = count - filled
  if (remaining <= 0) return pass1Allocs

  const pass2Allocs = assignOneEachFirst(
    eventId, pass2, itemType, startSlotIndex + filled, remaining, perMemberCap ?? 1,
  )
  const merged = [...pass1Allocs]
  for (const alloc of pass2Allocs) {
    const idx = merged.findIndex(a => a.slot_index === alloc.slot_index)
    if (idx >= 0) merged[idx] = alloc
  }
  return merged
}

export function generateAllocations(
  eventId: string,
  eventType: EventType,
  eligibleMembers: Member[],
  rewards: EventReward[],
  ctx: RotationContext,
  heldTurns: Map<string, Set<RewardType>>,
  designatedBidders: DesignatedBidder[] = [],
): GenerateResult {
  if (eligibleMembers.length === 0) throw new Error('No online eligible members')

  const slots = buildRewardSlots(rewards)
  if (slots.length === 0) throw new Error('No reward slots configured')

  const designatedByType = buildDesignatedSlotMap(designatedBidders)
  const allDesignatedIds = designatedMemberIds(designatedBidders)
  const allocations: Allocation[] = []
  const dueForNext: Record<string, string | null> = {}
  let slotIndex = 0

  for (const itemType of REWARD_ORDER) {
    const count = rewardQuantity(rewards, itemType)
    if (count === 0) continue

    if (itemType === 'mvp') {
      allocations.push(...assignFreeForAll(eventId, itemType, slotIndex, count))
      slotIndex += count
      continue
    }

    const designatedCount = designatedReserveForCount(itemType, count)
    const normalCount = count - designatedCount
    const designatedSlots = designatedByType.get(itemType) ?? new Map<number, string>()

    const orderedMembers = rotationOrder(eligibleMembers, eventId, itemType, ctx, heldTurns)
      .filter(m => !allDesignatedIds.has(m.id))
    const lastWinners = ctx.isFirstGeneratedEvent
      ? new Set<string>()
      : (ctx.lastEventWinners.get(itemType) ?? new Set<string>())

    let cap = rewardPerMemberCap(rewards, itemType, eventType)
    if (itemType === 'puppet') cap = 1

    if (normalCount > 0) {
      allocations.push(...assignRotatingItem(
        eventId,
        orderedMembers,
        itemType,
        slotIndex,
        normalCount,
        cap,
        lastWinners,
        itemType === 'light_dark' || itemType === 'time_space',
      ))
    }

    if (designatedCount > 0) {
      allocations.push(...assignDesignatedTail(
        eventId,
        itemType,
        slotIndex + normalCount,
        designatedCount,
        designatedSlots,
      ))
    }

    slotIndex += count
    dueForNext[itemType] = computeDueForNext(eligibleMembers, eventId, itemType, ctx, heldTurns)
  }

  for (const type of ROTATABLE_TYPES) {
    if (!(type in dueForNext)) {
      dueForNext[type] = computeDueForNext(eligibleMembers, eventId, type, ctx, heldTurns)
    }
  }

  return {
    allocations,
    dueForNext,
  }
}
