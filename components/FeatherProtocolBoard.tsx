import { buildBoardPages, chunkBoardPages, displayBoardName, pageRangeLabel } from '@/lib/board'
import { Event, RewardType } from '@/lib/types'

type ResultLike = {
  page_number: number
  row_number: number
  item_type: RewardType
  member_id: string | null
  name: string
}

const LEGEND: { type: RewardType; label: string }[] = [
  { type: 'puppet', label: 'Puppet' },
  { type: 'mvp', label: 'MVP' },
  { type: 'light_dark', label: 'L/D' },
  { type: 'time_space', label: 'T/S' },
]

type Props = {
  event: Event
  results: ResultLike[]
  exportId?: string
}

export function FeatherProtocolBoard({ event, results, exportId = 'feather-board-export' }: Props) {
  const pages = buildBoardPages(results)
  const columns = chunkBoardPages(pages, 10)
  const totalPages = pages.length

  if (!pages.length) {
    return <p className="muted">No allocations to display.</p>
  }

  return (
    <div className="feather-board" id={exportId}>
      <header className="feather-board-header">
        <div className="feather-board-brand">
          <img src="/mondragon-icon.png" alt="" className="feather-board-logo" width={40} height={40} />
          <div>
            <h2 className="feather-board-title">Mondra ROOC</h2>
            <p className="feather-board-subtitle">Auction allocation · {event.type} · {event.event_date}</p>
          </div>
        </div>
        <div className="feather-board-meta">
          <span className="feather-board-meta-pages">Pages 1–{totalPages}</span>
          <div className="feather-board-legend" aria-label="Item color key">
            {LEGEND.map(({ type, label }) => (
              <span key={type} className={`feather-board-legend-item legend-${type}`}>
                <span className="feather-board-legend-swatch" />
                {label}
              </span>
            ))}
            <span className="feather-board-legend-item legend-ffa">
              <span className="feather-board-legend-swatch" />
              FFA
            </span>
          </div>
        </div>
      </header>

      <div className="feather-board-columns">
        {columns.map((columnPages, colIndex) => (
          <div key={colIndex} className="feather-board-column">
            <h3 className="feather-board-column-title">{pageRangeLabel(columnPages)}</h3>
            <table className="feather-board-table">
              <thead>
                <tr>
                  <th className="feather-board-th-pg">Pg</th>
                  <th>Row 1</th>
                  <th>Row 2</th>
                  <th>Row 3</th>
                  <th>Row 4</th>
                </tr>
              </thead>
              <tbody>
                {columnPages.map(page => (
                  <tr key={page.pageNumber}>
                    <td className="feather-board-pg">
                      <span>{page.pageNumber}</span>
                    </td>
                    {page.rows.map((cell, rowIndex) => {
                      if (!cell) {
                        return (
                          <td key={rowIndex}>
                            <span className="feather-board-empty">—</span>
                          </td>
                        )
                      }
                      const itemClass = cell.isFfa ? 'ffa-cell' : `item-${cell.itemType}`
                      return (
                        <td key={rowIndex} className={itemClass}>
                          <span className="feather-board-name" title={cell.name}>
                            {cell.isFfa ? 'Free For All' : displayBoardName(cell.name, 38)}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  )
}
