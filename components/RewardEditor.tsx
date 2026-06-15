import { REWARD_LABELS } from '@/lib/reward-defaults'
import { RewardType } from '@/lib/types'

export type RewardFormRow = { quantity: number; per_member_cap: number }

type Props = {
  rewards: Record<RewardType, RewardFormRow>
  onChange: (rewards: Record<RewardType, RewardFormRow>) => void
  disabled?: boolean
}

export function RewardEditor({ rewards, onChange, disabled }: Props) {
  function update(key: RewardType, patch: Partial<RewardFormRow>) {
    onChange({ ...rewards, [key]: { ...rewards[key], ...patch } })
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Item</th>
          <th>Total supply</th>
          <th>Per-player limit</th>
        </tr>
      </thead>
      <tbody>
        {(Object.keys(rewards) as RewardType[]).map(key => (
          <tr key={key}>
            <td>{REWARD_LABELS[key]}</td>
            <td>
              <input
                type="number"
                min="0"
                value={rewards[key].quantity}
                disabled={disabled}
                onChange={e => update(key, { quantity: Number(e.target.value) })}
              />
            </td>
            <td>
              <input
                type="number"
                min="0"
                value={rewards[key].per_member_cap}
                disabled={disabled}
                onChange={e => update(key, { per_member_cap: Number(e.target.value) })}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
