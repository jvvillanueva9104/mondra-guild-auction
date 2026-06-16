'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { EventBanner } from '@/components/EventBanner'
import { FeatherProtocolBoard } from '@/components/FeatherProtocolBoard'
import { useEvent } from '@/hooks/useEvent'
import { downloadBoardPng } from '@/lib/export-board'
import { errorMessage } from '@/lib/errors'
import { useSupabase } from '@/lib/supabase'
import { RewardType } from '@/lib/types'

type Result = {
  item_type: RewardType
  slot_index: number
  page_number: number
  row_number: number
  member_id: string | null
  members: { name: string } | null
}

const ITEM_LABELS: Record<RewardType, string> = {
  puppet: 'Puppet',
  mvp: 'MVP',
  light_dark: 'Light/Dark',
  time_space: 'Time/Space',
}

function playerLabel(row: Result): string {
  if (!row.member_id) return 'Free For All'
  return row.members?.name ?? 'Unknown'
}

export default function ResultsPage() {
  const { id } = useParams<{ id: string }>()
  const supabase = useSupabase()
  const { event, loading: eventLoading } = useEvent(id)
  const [results, setResults] = useState<Result[]>([])
  const [view, setView] = useState<'board' | 'table'>('board')
  const [downloading, setDownloading] = useState(false)

  async function load() {
    if (!supabase) return
    const { data, error } = await supabase
      .from('auction_allocations')
      .select('item_type,slot_index,page_number,row_number,member_id,members(name)')
      .eq('event_id', id)
      .order('slot_index')
    if (error) return alert(error.message)
    setResults((data ?? []).map(row => ({
      ...row,
      members: Array.isArray(row.members) ? row.members[0] ?? null : row.members,
    })))
  }

  useEffect(() => { load() }, [supabase, id])

  const boardResults = useMemo(
    () => results.map(r => ({
      page_number: r.page_number,
      row_number: r.row_number,
      item_type: r.item_type,
      member_id: r.member_id,
      name: playerLabel(r),
    })),
    [results],
  )

  const discordText = useMemo(
    () => results.map(r =>
      `${playerLabel(r)} - ${ITEM_LABELS[r.item_type]} - Page ${r.page_number}, Row ${r.row_number}`,
    ).join('\n'),
    [results],
  )

  async function copyDiscord() {
    await navigator.clipboard.writeText(discordText)
    alert('Copied')
  }

  async function downloadBoardImage() {
    if (!event || !results.length) return
    setDownloading(true)
    try {
      await downloadBoardPng(
        'feather-board-export',
        `mondra-${event.type}-${event.event_date}-board.png`,
      )
    } catch (e: unknown) {
      alert(errorMessage(e, 'Could not create image'))
    } finally {
      setDownloading(false)
    }
  }

  function downloadCsv() {
    const csv = [
      'Player,Item,Page,Row',
      ...results.map(r =>
        `"${playerLabel(r)}",${ITEM_LABELS[r.item_type]},${r.page_number},${r.row_number}`,
      ),
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'auction-results.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (eventLoading || !supabase) return <main><p className="muted">Loading…</p></main>
  if (!event) return <main><p>Event not found.</p></main>

  if (event.status !== 'generated') {
    return <main>
      <h1>Results</h1>
      <EventBanner event={event} />
      <section className="card">
        <p className="muted">Allocations have not been generated yet.</p>
        <div className="row">
          {event.status === 'draft' && (
            <Link className="btn" href={`/events/${id}/attendance`}>Continue Setup</Link>
          )}
          {event.status === 'locked' && (
            <Link className="btn" href={`/events/${id}/generate`}>Go to Generate</Link>
          )}
        </div>
      </section>
    </main>
  }

  return <main className="results-main">
    <h1>Results</h1>
    <EventBanner event={event} />
    <section className="card">
      <div className="row">
        <button
          type="button"
          className={view === 'board' ? undefined : 'secondary'}
          onClick={() => setView('board')}
        >
          Board view
        </button>
        <button
          type="button"
          className={view === 'table' ? undefined : 'secondary'}
          onClick={() => setView('table')}
        >
          Table view
        </button>
        <button onClick={copyDiscord} disabled={!results.length}>Copy for Discord</button>
        <button
          className="secondary"
          onClick={downloadBoardImage}
          disabled={!results.length || downloading || view !== 'board'}
          title={view !== 'board' ? 'Switch to Board view to download image' : undefined}
        >
          {downloading ? 'Creating image…' : 'Download PNG'}
        </button>
        <button className="secondary" onClick={downloadCsv} disabled={!results.length}>Export CSV</button>
        <Link className="btn secondary" href="/">Back to Events</Link>
      </div>
    </section>

    {view === 'board' ? (
      <section className="card feather-board-wrap">
        <p className="muted feather-board-hint">Color bar on each cell = item type (see legend). Download PNG for Discord.</p>
        <FeatherProtocolBoard event={event} results={boardResults} />
      </section>
    ) : (
      <section className="card">
        <table>
          <thead><tr><th>Player</th><th>Item</th><th>Page</th><th>Row</th></tr></thead>
          <tbody>
            {results.map(r => (
              <tr key={r.slot_index} className={!r.member_id ? 'ffa-row' : undefined}>
                <td>{playerLabel(r)}</td>
                <td>{ITEM_LABELS[r.item_type]}</td>
                <td>{r.page_number}</td>
                <td>{r.row_number}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    )}
  </main>
}
