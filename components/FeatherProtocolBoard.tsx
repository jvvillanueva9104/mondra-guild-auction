import { buildBoardPages, chunkBoardPages, displayBoardName, itemShortLabel, pageRangeLabel } from '@/lib/board'
import { Event } from '@/lib/types'

type ResultLike = {
  page_number: number
  row_number: number
  item_type: import('@/lib/types').RewardType
  member_id: string | null
  name: string
}

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
          <img src="/mondragon-icon.png" alt="" className="feather-board-logo" width={36} height={36} />
          <h2 className="feather-board-title">Mondra ROOC</h2>
        </div>
        <div className="feather-board-meta">
          <span>{event.type} · {event.event_date}</span>
          <span>PAGES 1–{totalPages}</span>
        </div>
      </header>

      <div className="feather-board-scroll">
        <div className="feather-board-columns">
          {columns.map((columnPages, colIndex) => (
            <div key={colIndex} className="feather-board-column">
              <h3 className="feather-board-column-title">{pageRangeLabel(columnPages)}</h3>
              <table className="feather-board-table">
                <thead>
                  <tr>
                    <th>PG</th>
                    <th>1</th>
                    <th>2</th>
                    <th>3</th>
                    <th>4</th>
                  </tr>
                </thead>
                <tbody>
                  {columnPages.map(page => (
                    <tr key={page.pageNumber}>
                      <td className="feather-board-pg">
                        <span>{page.pageNumber}</span>
                      </td>
                      {page.rows.map((cell, rowIndex) => (
                        <td
                          key={rowIndex}
                          className={cell ? (cell.isFfa ? 'ffa-cell' : `item-cell item-${cell.itemType}`) : undefined}
                        >
                          {cell ? (
                            <div className="feather-board-cell">
                              <span className="feather-board-name" title={cell.name}>
                                {displayBoardName(cell.name)}
                              </span>
                              <span className={`feather-board-badge badge-${cell.itemType}`}>
                                {itemShortLabel(cell.itemType)}
                              </span>
                            </div>
                          ) : (
                            <span className="feather-board-empty">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
