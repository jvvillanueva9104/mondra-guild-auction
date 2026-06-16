'use client'
import { useEffect, useRef, useState } from 'react'
import { useSupabase } from '@/lib/supabase'
import { Member } from '@/lib/types'

export default function MembersPage() {
  const supabase = useSupabase()
  const [members, setMembers] = useState<Member[]>([])
  const [name, setName] = useState('')
  const eligibleHeaderRef = useRef<HTMLInputElement>(null)

  const allEligible = members.length > 0 && members.every(m => m.is_auction_eligible)
  const someEligible = members.some(m => m.is_auction_eligible)

  async function load() {
    if (!supabase) return
    const { data } = await supabase.from('members').select('*').order('name')
    setMembers(data ?? [])
  }

  useEffect(() => { load() }, [supabase])

  useEffect(() => {
    if (eligibleHeaderRef.current) {
      eligibleHeaderRef.current.indeterminate = someEligible && !allEligible
    }
  }, [someEligible, allEligible])

  async function setAllEligible(checked: boolean) {
    if (!supabase || !members.length) return
    const { error } = await supabase
      .from('members')
      .update({ is_auction_eligible: checked })
      .in('id', members.map(m => m.id))
    if (error) alert(error.message)
    else load()
  }

  async function add() {
    if (!supabase || !name.trim()) return
    const { error } = await supabase.from('members').insert({ name })
    if (error) alert(error.message)
    else { setName(''); load() }
  }

  async function update(id: string, patch: Partial<Member>) {
    if (!supabase) return
    const { error } = await supabase.from('members').update(patch).eq('id', id)
    if (error) alert(error.message)
    else load()
  }

  async function removeMembersFromDb(ids: string[]) {
    if (!supabase || ids.length === 0) return

    const { error: attendanceError } = await supabase.from('attendance').delete().in('member_id', ids)
    if (attendanceError) throw attendanceError

    const { error: participantsError } = await supabase.from('event_participants').delete().in('member_id', ids)
    if (participantsError) throw participantsError

    const { error: allocationsError } = await supabase
      .from('auction_allocations')
      .update({ member_id: null })
      .in('member_id', ids)
    if (allocationsError) throw allocationsError

    const { error } = await supabase.from('members').delete().in('id', ids)
    if (error) throw error
  }

  async function removeMember(member: Member) {
    if (!supabase) return
    if (!confirm(
      `Remove ${member.name}? This clears their attendance and auction pool links. ` +
      'Past generated results keep allocation rows but lose their name where assigned. ' +
      'They will be re-added if they react on Discord check-in again.',
    )) return

    try {
      await removeMembersFromDb([member.id])
      load()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Could not remove member')
    }
  }

  async function removeAllMembers() {
    if (!supabase || !members.length) return
    const label = `${members.length} member${members.length === 1 ? '' : 's'}`
    if (!confirm(
      `Remove ${label}? This clears their attendance and auction pool links. ` +
      'Past generated results keep allocation rows but lose member names where assigned. ' +
      'Discord check-in will re-add members when they react again.',
    )) return

    try {
      await removeMembersFromDb(members.map(m => m.id))
      load()
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Could not remove members')
    }
  }

  if (!supabase) return <main><p className="muted">Loading…</p></main>

  return <main>
    <h1>Members</h1>
    <section className="card">
      <div className="row">
        <input placeholder="Member name" value={name} onChange={e => setName(e.target.value)} />
        <button onClick={add}>Add Member</button>
        {members.length > 0 && (
          <button type="button" className="danger" onClick={removeAllMembers}>
            Remove all members
          </button>
        )}
      </div>
      <p className="muted">
        Remove someone who left the guild with the row action, or clear test names with Remove all.
        Members are recreated automatically when they react on Discord again.
      </p>
    </section>
    <section className="card">
      {!members.length && <p className="muted">No members on the roster.</p>}
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>
              <label className="check-all-label">
                <input
                  ref={eligibleHeaderRef}
                  type="checkbox"
                  checked={allEligible}
                  onChange={e => setAllEligible(e.target.checked)}
                />
                Auction Eligible
              </label>
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {members.map(m => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>
                <select
                  value={m.status}
                  onChange={e => update(m.id, {
                    status: e.target.value as Member['status'],
                    left_at: e.target.value === 'left' ? new Date().toISOString().slice(0, 10) : null,
                  })}
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                  <option value="left">left</option>
                </select>
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={m.is_auction_eligible}
                  onChange={e => update(m.id, { is_auction_eligible: e.target.checked })}
                />
              </td>
              <td>
                <button type="button" className="danger secondary" onClick={() => removeMember(m)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  </main>
}
