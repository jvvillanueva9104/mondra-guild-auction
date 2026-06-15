import { hashTiebreak, seededShuffle } from './shuffle'
import { EventType, Member, RewardType } from './types'

export const ROTATABLE_TYPES: RewardType[] = ['puppet', 'light_dark', 'time_space']

export type RotationContext = {
  isFirstGeneratedEvent: boolean
  firstGeneratedEventId: string | null
  /** Members who were online in any prior generated event pool. */
  priorPoolMemberIds: Set<string>
  /** Named slot winners from the last generated event, per item type. */
  lastEventWinners: Map<RewardType, Set<string>>
  allTimeCounts: Map<string, Map<RewardType, number>>
  /** Held turns entering this event (from previous allocation run). */
  heldTurns: Map<string, Set<RewardType>>
  /** Who was due this event per item type (from previous run's due_for_next). */
  previousDue: Map<RewardType, string | null>
  lastEventId: string | null
  lastEventDate: string | null
  lastEventType: EventType | null
}

export const EMPTY_ROTATION_CONTEXT: RotationContext = {
  isFirstGeneratedEvent: true,
  firstGeneratedEventId: null,
  priorPoolMemberIds: new Set(),
  lastEventWinners: new Map(),
  allTimeCounts: new Map(),
  heldTurns: new Map(),
  previousDue: new Map(),
  lastEventId: null,
  lastEventDate: null,
  lastEventType: null,
}

export function cloneHeldTurns(
  held: Map<string, Set<RewardType>>,
): Map<string, Set<RewardType>> {
  return new Map([...held.entries()].map(([id, types]) => [id, new Set(types)]))
}

export function serializeHeldTurns(held: Map<string, Set<RewardType>>): Record<string, RewardType[]> {
  return Object.fromEntries([...held.entries()].map(([id, types]) => [id, [...types]]))
}

export function parseHeldTurns(raw: unknown): Map<string, Set<RewardType>> {
  const held = new Map<string, Set<RewardType>>()
  if (!raw || typeof raw !== 'object') return held
  for (const [memberId, types] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(types)) {
      held.set(memberId, new Set(types.filter(t => typeof t === 'string') as RewardType[]))
    }
  }
  return held
}

export function parseDueMembers(raw: unknown): Map<RewardType, string | null> {
  const due = new Map<RewardType, string | null>()
  if (!raw || typeof raw !== 'object') return due
  for (const type of ROTATABLE_TYPES) {
    const id = (raw as Record<string, unknown>)[type]
    due.set(type, typeof id === 'string' ? id : null)
  }
  return due
}

function lifetimeReceiveCount(
  ctx: RotationContext,
  memberId: string,
  itemType: RewardType,
): number {
  return ctx.allTimeCounts.get(memberId)?.get(itemType) ?? 0
}

function memberBand(
  memberId: string,
  itemType: RewardType,
  ctx: RotationContext,
  heldTurns: Map<string, Set<RewardType>>,
  sittingOut: boolean,
): number {
  if (heldTurns.get(memberId)?.has(itemType)) return 0
  if (sittingOut) return 3
  if (ctx.priorPoolMemberIds.has(memberId)) return 1
  return 2
}

/**
 * Update held turns at the start of generate:
 * - Due member absent → grant hold (or forfeit if already holding).
 * - Due member present but not bidding (no gold / not online) → no hold change.
 */
export function updateHeldTurns(
  ctx: RotationContext,
  attendedMemberIds: Set<string>,
  noGoldMemberIds: Set<string>,
): Map<string, Set<RewardType>> {
  const held = cloneHeldTurns(ctx.heldTurns)

  for (const type of ROTATABLE_TYPES) {
    const dueId = ctx.previousDue.get(type)
    if (!dueId) continue

    if (!attendedMemberIds.has(dueId)) {
      const memberHeld = held.get(dueId) ?? new Set<RewardType>()
      if (memberHeld.has(type)) {
        memberHeld.delete(type)
        if (memberHeld.size === 0) held.delete(dueId)
        else held.set(dueId, memberHeld)
      } else {
        if (!held.has(dueId)) held.set(dueId, new Set())
        held.get(dueId)!.add(type)
      }
      continue
    }

    if (noGoldMemberIds.has(dueId)) continue
  }

  return held
}

/** Held turns are consumed when the member attends and enters the eligible pool. */
export function consumeHeldTurns(
  heldTurns: Map<string, Set<RewardType>>,
  eligibleMemberIds: Set<string>,
): Map<string, Set<RewardType>> {
  const next = cloneHeldTurns(heldTurns)
  for (const memberId of eligibleMemberIds) {
    next.delete(memberId)
  }
  return next
}

/**
 * Order members for puppet/feather assignment.
 * Band 0: held turn → 1: prior pool → 2: late joiner → 3: sit-out (overflow pass).
 */
export function rotationOrder(
  members: Member[],
  seed: string,
  itemType: RewardType,
  ctx: RotationContext,
  heldTurns: Map<string, Set<RewardType>>,
): Member[] {
  if (ctx.isFirstGeneratedEvent) {
    return seededShuffle(members, `${seed}:${itemType}`)
  }

  const sittingOut = ctx.lastEventWinners.get(itemType) ?? new Set<string>()

  return [...members].sort((a, b) => {
    const bandA = memberBand(a.id, itemType, ctx, heldTurns, sittingOut.has(a.id))
    const bandB = memberBand(b.id, itemType, ctx, heldTurns, sittingOut.has(b.id))
    if (bandA !== bandB) return bandA - bandB

    const aLife = lifetimeReceiveCount(ctx, a.id, itemType)
    const bLife = lifetimeReceiveCount(ctx, b.id, itemType)
    if (aLife !== bLife) return aLife - bLife

    return hashTiebreak(seed, itemType, a.id) - hashTiebreak(seed, itemType, b.id)
  })
}

/** First non-sit-out member in rotation order is due next event for this item type. */
export function computeDueForNext(
  members: Member[],
  seed: string,
  itemType: RewardType,
  ctx: RotationContext,
  heldTurns: Map<string, Set<RewardType>>,
): string | null {
  const ordered = rotationOrder(members, seed, itemType, ctx, heldTurns)
  const sittingOut = ctx.lastEventWinners.get(itemType) ?? new Set<string>()
  return ordered.find(m => !sittingOut.has(m.id))?.id ?? null
}

export function splitPassMembers(
  orderedMembers: Member[],
  lastWinners: Set<string>,
): { pass1: Member[]; pass2: Member[] } {
  return {
    pass1: orderedMembers.filter(m => !lastWinners.has(m.id)),
    pass2: orderedMembers.filter(m => lastWinners.has(m.id)),
  }
}
