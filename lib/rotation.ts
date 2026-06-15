import { hashTiebreak } from './shuffle'
import { EventType, Member, RewardType } from './types'

export type RotationHistory = {
  lastEventByMember: Map<string, Set<RewardType>>
  allTimeCounts: Map<string, Map<RewardType, number>>
  lastEventId: string | null
  lastEventDate: string | null
  lastEventType?: EventType | null
}

export const EMPTY_ROTATION_HISTORY: RotationHistory = {
  lastEventByMember: new Map(),
  allTimeCounts: new Map(),
  lastEventId: null,
  lastEventDate: null,
  lastEventType: null,
}

export function memberReceivedLastEvent(
  history: RotationHistory,
  memberId: string,
  itemType: RewardType,
): boolean {
  return history.lastEventByMember.get(memberId)?.has(itemType) ?? false
}

function lifetimeReceiveCount(
  history: RotationHistory,
  memberId: string,
  itemType: RewardType,
): number {
  return history.allTimeCounts.get(memberId)?.get(itemType) ?? 0
}

/**
 * Order members for assignment: those who missed last event (and received less overall) go first.
 * Repeat winners from the last same-type event are deprioritized.
 */
export function rotationOrder(
  members: Member[],
  seed: string,
  itemType: RewardType,
  history: RotationHistory,
): Member[] {
  return [...members].sort((a, b) => {
    const aLast = memberReceivedLastEvent(history, a.id, itemType) ? 1 : 0
    const bLast = memberReceivedLastEvent(history, b.id, itemType) ? 1 : 0
    if (aLast !== bLast) return aLast - bLast

    const aLife = lifetimeReceiveCount(history, a.id, itemType)
    const bLife = lifetimeReceiveCount(history, b.id, itemType)
    if (aLife !== bLife) return aLife - bLife

    return hashTiebreak(seed, itemType, a.id) - hashTiebreak(seed, itemType, b.id)
  })
}
