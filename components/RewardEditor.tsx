import { useEffect, useState } from 'react'
import { REWARD_LABELS } from '@/lib/reward-defaults'
import { RewardType } from '@/lib/types'

export type RewardFormRow = { quantity: number; per_member_cap: number }

type Props = {
  rewards: Record<RewardType, RewardFormRow>
  onChange: (rewards: Record<RewardType, RewardFormRow>) => void
  disabled?: boolean
}

function NumberField({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    setDraft(String(value))
  }, [value])

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      disabled={disabled}
      onChange={e => {
        const raw = e.target.value
        if (raw !== '' && !/^\d+$/.test(raw)) return
        setDraft(raw)
        if (raw !== '') onChange(parseInt(raw, 10))
      }}
      onBlur={() => {
        const parsed = draft === '' ? 0 : parseInt(draft, 10)
        const next = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
        onChange(next)
        setDraft(String(next))
      }}
    />
  )
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
              <NumberField
                value={rewards[key].quantity}
                disabled={disabled}
                onChange={quantity => update(key, { quantity })}
              />
            </td>
            <td>
              <NumberField
                value={rewards[key].per_member_cap}
                disabled={disabled}
                onChange={per_member_cap => update(key, { per_member_cap })}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
