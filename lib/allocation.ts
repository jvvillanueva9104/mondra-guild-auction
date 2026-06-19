import {
  computeDueForNext,
  rotationOrder,
  ROTATABLE_TYPES,
  RotationContext,
  splitPassMembers,
} from './rotation'
import { DEFAULT_PER_MEMBER_CAPS } from './reward-defaults'
import {
  buildDesignatedSlotMap,
  DESIGNATED_BOARD_ORDER,
  DESIGNATED_BOARD_SLOTS,
  designatedMemberIds,
  DesignatedBidder,
} from './designated'
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

/** Same slot count for every member; leftover slots stay FFA. */
function equalSlotsPerMember(
  memberCount: number,
  count: number,
  perMemberCap?: number,
): number {
  if (memberCount === 0 || count <= 0) return 0
  const evenShare = Math.floor(count / memberCount)
  if (perMemberCap !== undefined) return Math.min(perMemberCap, evenShare)
  return evenShare
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

  const slotsEach = equalSlotsPerMember(members.length, count, perMemberCap)
  let slot = startSlotIndex
  for (const member of members) {
    for (let i = 0; i < slotsEach; i++) {
      assignments.set(slot, member.id)
      slot++
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
    // Rotation order already prioritizes non-sit-out members; distribute evenly in one pass.
    return assignPageGroupedForMembers(
      eventId, orderedMembers, itemType, startSlotIndex, count, perMemberCap,
    )
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

    const orderedMembers = rotationOrder(eligibleMembers, itemType, ctx, heldTurns)
      .filter(m => !allDesignatedIds.has(m.id))
    const lastWinners = ctx.isFirstGeneratedEvent
      ? new Set<string>()
      : (ctx.lastEventWinners.get(itemType) ?? new Set<string>())

    let cap = rewardPerMemberCap(rewards, itemType, eventType)
    if (itemType === 'puppet') cap = 1

    allocations.push(...assignRotatingItem(
      eventId,
      orderedMembers,
      itemType,
      slotIndex,
      count,
      cap,
      lastWinners,
      itemType === 'light_dark' || itemType === 'time_space',
    ))

    slotIndex += count
    dueForNext[itemType] = computeDueForNext(eligibleMembers, itemType, ctx, heldTurns)
  }

  for (const itemType of DESIGNATED_BOARD_ORDER) {
    const designatedSlots = designatedByType.get(itemType) ?? new Map<number, string>()
    const reserve = DESIGNATED_BOARD_SLOTS[itemType]
    allocations.push(...assignDesignatedTail(
      eventId,
      itemType,
      slotIndex,
      reserve,
      designatedSlots,
    ))
    slotIndex += reserve
  }

  for (const type of ROTATABLE_TYPES) {
    if (!(type in dueForNext)) {
      dueForNext[type] = computeDueForNext(eligibleMembers, type, ctx, heldTurns)
    }
  }

  return {
    allocations,
    dueForNext,
  }
}
