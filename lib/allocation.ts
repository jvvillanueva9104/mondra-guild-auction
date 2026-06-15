import { RotationHistory, rotationOrder } from './rotation'
import { DEFAULT_PER_MEMBER_CAPS } from './reward-defaults'
import { Allocation, EventReward, EventType, Member, RewardType } from './types'

export { seededShuffle } from './shuffle'

export const ROWS_PER_PAGE = 4
export const REWARD_ORDER: RewardType[] = ['puppet', 'mvp', 'light_dark', 'time_space']

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
): Allocation {
  return {
    event_id: eventId,
    member_id: memberId,
    item_type: itemType,
    ...slotMeta(slotIndex),
  }
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

/**
 * Feathers: equal share per bidder (respecting cap), filled sequentially row by row in rotation order.
 * Slots left after the equal split stay Free For All.
 */
function assignPageGrouped(
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

export function generateAllocations(
  eventId: string,
  eventType: EventType,
  eligibleMembers: Member[],
  rewards: EventReward[],
  history: RotationHistory,
): Allocation[] {
  if (eligibleMembers.length === 0) throw new Error('No online eligible members')

  const slots = buildRewardSlots(rewards)
  if (slots.length === 0) throw new Error('No reward slots configured')

  const allocations: Allocation[] = []
  let slotIndex = 0

  for (const itemType of REWARD_ORDER) {
    const count = rewardQuantity(rewards, itemType)
    if (count === 0) continue

    const orderedMembers = itemType === 'mvp'
      ? eligibleMembers
      : rotationOrder(eligibleMembers, eventId, itemType, history)

    const cap = rewardPerMemberCap(rewards, itemType, eventType)

    let batch: Allocation[]
    switch (itemType) {
      case 'puppet':
        batch = assignOneEachFirst(eventId, orderedMembers, itemType, slotIndex, count, cap ?? 1)
        break
      case 'mvp':
        batch = assignFreeForAll(eventId, itemType, slotIndex, count)
        break
      case 'light_dark':
      case 'time_space':
        batch = assignPageGrouped(eventId, orderedMembers, itemType, slotIndex, count, cap)
        break
    }

    allocations.push(...batch)
    slotIndex += count
  }

  return allocations
}
