export type RewardType = 'puppet' | 'mvp' | 'light_dark' | 'time_space'
export type EventType = 'EO' | 'GL'
export type Member = { id: string; name: string; status: 'active'|'inactive'|'left'; joined_at: string; left_at?: string | null; is_auction_eligible: boolean }
export type Event = { id: string; type: EventType; event_date: string; status: 'draft'|'locked'|'designated'|'generated' }
export type EventReward = { reward_type: RewardType; quantity: number; per_member_cap?: number | null }
export type Allocation = {
  event_id: string
  member_id: string | null
  item_type: RewardType
  slot_index: number
  page_number: number
  row_number: number
  is_designated?: boolean
}
