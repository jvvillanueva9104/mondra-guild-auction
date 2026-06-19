import { ROWS_PER_PAGE } from './allocation'
import { rotationOrder, ROTATABLE_TYPES, RotationContext } from './rotation'
import { Member, RewardType } from './types'

/** Five people designated — each gets 1 puppet, 1 L/D page, 1 T/S page on the board tail. */
export const DESIGNATED_BIDDER_COUNT = 5
export const DESIGNATED_PAGES = 5

/** Fixed designated board block appended after all normal item totals. */
export const DESIGNATED_BOARD_SLOTS: Record<'puppet' | 'light_dark' | 'time_space', number> = {
  puppet: DESIGNATED_BIDDER_COUNT,
  light_dark: DESIGNATED_PAGES * ROWS_PER_PAGE,
  time_space: DESIGNATED_PAGES * ROWS_PER_PAGE,
}

export const DESIGNATED_BOARD_ORDER: ('puppet' | 'light_dark' | 'time_space')[] = [
  'puppet',
  'light_dark',
  'time_space',
]

export function totalDesignatedBoardSlots(): number {
  return DESIGNATED_BOARD_ORDER.reduce((sum, type) => sum + DESIGNATED_BOARD_SLOTS[type], 0)
}

export type DesignatedBidder = {
  memberId: string
  bidderIndex: number
}

export function generateDesignatedBidders(
  eligibleMembers: Member[],
  ctx: RotationContext,
  heldTurns: Map<string, Set<RewardType>>,
): DesignatedBidder[] {
  const ordered = rotationOrder(eligibleMembers, 'puppet', ctx, heldTurns)
  const out: DesignatedBidder[] = []

  for (const member of ordered) {
    if (out.length >= DESIGNATED_BIDDER_COUNT) break
    if (out.some(b => b.memberId === member.id)) continue
    out.push({ memberId: member.id, bidderIndex: out.length })
  }

  return out
}

export function replaceDesignatedBidder(
  bidderIndex: number,
  eligibleMembers: Member[],
  ctx: RotationContext,
  heldTurns: Map<string, Set<RewardType>>,
  current: DesignatedBidder[],
  removedMemberId: string,
): string | null {
  const ordered = rotationOrder(eligibleMembers, 'puppet', ctx, heldTurns)
  const exclude = new Set<string>([removedMemberId])
  for (const row of current) {
    if (row.bidderIndex !== bidderIndex) exclude.add(row.memberId)
  }

  for (const member of ordered) {
    if (exclude.has(member.id)) continue
    return member.id
  }

  return null
}

/** Map board tail slot → member for each rotatable item type. */
export function buildDesignatedSlotMap(
  bidders: DesignatedBidder[],
): Map<RewardType, Map<number, string>> {
  const map = new Map<RewardType, Map<number, string>>()
  for (const type of ROTATABLE_TYPES) {
    map.set(type, new Map())
  }

  for (const { memberId, bidderIndex } of bidders) {
    map.get('puppet')!.set(bidderIndex, memberId)
    for (let row = 0; row < ROWS_PER_PAGE; row++) {
      const slot = bidderIndex * ROWS_PER_PAGE + row
      map.get('light_dark')!.set(slot, memberId)
      map.get('time_space')!.set(slot, memberId)
    }
  }

  return map
}

export function designatedMemberIds(bidders: DesignatedBidder[]): Set<string> {
  return new Set(bidders.map(b => b.memberId))
}
