import { EventType, RewardType } from './types'

export const REWARD_LABELS: Record<RewardType, string> = {
  puppet: 'Puppet',
  mvp: 'MVP',
  light_dark: 'Light/Dark',
  time_space: 'Time/Space',
}

/** Default per-player limits when creating an event — officers can override per night. */
export const DEFAULT_PER_MEMBER_CAPS: Record<EventType, Record<RewardType, number>> = {
  EO: { puppet: 1, mvp: 3, light_dark: 4, time_space: 10 },
  GL: { puppet: 1, mvp: 3, light_dark: 6, time_space: 10 },
}

export type RewardInput = { quantity: number; per_member_cap: number }

export function emptyRewards(type: EventType): Record<RewardType, RewardInput> {
  const caps = DEFAULT_PER_MEMBER_CAPS[type]
  return {
    puppet: { quantity: 0, per_member_cap: caps.puppet },
    mvp: { quantity: 0, per_member_cap: caps.mvp },
    light_dark: { quantity: 0, per_member_cap: caps.light_dark },
    time_space: { quantity: 0, per_member_cap: caps.time_space },
  }
}
