import { ROWS_PER_PAGE } from './allocation'
import { DEFAULT_PER_MEMBER_CAPS } from './reward-defaults'
import { rotationOrder, ROTATABLE_TYPES, RotationContext } from './rotation'
import { EventType, Member, RewardType } from './types'

export const DESIGNATED_PAGES = 5

export const DESIGNATED_SLOT_COUNT: Record<RewardType, number> = {
  puppet: 5,
  mvp: 0,
  light_dark: DESIGNATED_PAGES * ROWS_PER_PAGE,
  time_space: DESIGNATED_PAGES * ROWS_PER_PAGE,
}

export type DesignatedAssignment = {
  memberId: string
  itemType: RewardType
  slotIndex: number
}

export type DesignatedRow = DesignatedAssignment & {
  memberName: string
}

function designatedCap(itemType: RewardType, eventType: EventType): number {
  if (itemType === 'puppet') return 1
  return DEFAULT_PER_MEMBER_CAPS[eventType][itemType]
}

function fillSlotsFromRotationHead(
  ordered: Member[],
  slotCount: number,
  perMemberCap: number,
  pageGrouped: boolean,
  excludeIds: Set<string> = new Set(),
): Map<number, string> {
  const slots = new Map<number, string | null>()
  for (let i = 0; i < slotCount; i++) slots.set(i, null)

  const memberCount = (memberId: string) =>
    [...slots.values()].filter(id => id === memberId).length

  if (pageGrouped) {
    const perMember = Math.min(
      perMemberCap,
      Math.max(1, Math.floor(slotCount / Math.max(ordered.length, 1))),
    )
    for (const member of ordered) {
      if (excludeIds.has(member.id)) continue
      let assigned = 0
      for (let s = 0; s < slotCount && assigned < perMember; s++) {
        if (slots.get(s) !== null) continue
        if (memberCount(member.id) >= perMemberCap) break
        slots.set(s, member.id)
        assigned++
      }
    }
    return slots as Map<number, string>
  }

  for (const member of ordered) {
    if (excludeIds.has(member.id)) continue
    if (memberCount(member.id) >= perMemberCap) continue
    for (let s = 0; s < slotCount; s++) {
      if (slots.get(s) !== null) continue
      slots.set(s, member.id)
      break
    }
    if ([...slots.values()].every(v => v !== null)) break
  }

  return slots as Map<number, string>
}

export function generateDesignatedAssignments(
  eventId: string,
  eventType: EventType,
  eligibleMembers: Member[],
  ctx: RotationContext,
  heldTurns: Map<string, Set<RewardType>>,
): DesignatedAssignment[] {
  const out: DesignatedAssignment[] = []

  for (const itemType of ROTATABLE_TYPES) {
    const slotCount = DESIGNATED_SLOT_COUNT[itemType]
    const ordered = rotationOrder(eligibleMembers, eventId, itemType, ctx, heldTurns)
    const cap = designatedCap(itemType, eventType)
    const pageGrouped = itemType === 'light_dark' || itemType === 'time_space'
    const slots = fillSlotsFromRotationHead(ordered, slotCount, cap, pageGrouped)

    for (const [slotIndex, memberId] of slots) {
      out.push({ memberId, itemType, slotIndex })
    }
  }

  return out
}

export function replaceDesignatedSlot(
  eventId: string,
  eventType: EventType,
  itemType: RewardType,
  slotIndex: number,
  eligibleMembers: Member[],
  ctx: RotationContext,
  heldTurns: Map<string, Set<RewardType>>,
  currentAssignments: DesignatedAssignment[],
  removedMemberId: string,
): string | null {
  const slotCount = DESIGNATED_SLOT_COUNT[itemType]
  const cap = designatedCap(itemType, eventType)
  const pageGrouped = itemType === 'light_dark' || itemType === 'time_space'
  const ordered = rotationOrder(eligibleMembers, eventId, itemType, ctx, heldTurns)

  const exclude = new Set<string>([removedMemberId])
  for (const row of currentAssignments) {
    if (row.itemType !== itemType) continue
    if (row.slotIndex === slotIndex) continue
    exclude.add(row.memberId)
  }

  const slots = fillSlotsFromRotationHead(ordered, slotCount, cap, pageGrouped, exclude)
  return slots.get(slotIndex) ?? null
}

export function designatedReserveForCount(itemType: RewardType, totalCount: number): number {
  if (totalCount <= 0) return 0
  return Math.min(DESIGNATED_SLOT_COUNT[itemType], totalCount)
}

export function buildDesignatedMap(
  rows: DesignatedAssignment[],
): Map<RewardType, Map<number, string>> {
  const map = new Map<RewardType, Map<number, string>>()
  for (const row of rows) {
    if (!map.has(row.itemType)) map.set(row.itemType, new Map())
    map.get(row.itemType)!.set(row.slotIndex, row.memberId)
  }
  return map
}
