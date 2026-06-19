import { Event } from '@/lib/types'

const labels: Record<Event['status'], string> = {
  draft: 'Draft — attendance and auction pool can still be edited.',
  locked: 'Locked — generate and confirm designated bidders before bidding.',
  designated: 'Designated locked — enter item totals when bidding starts, then generate the board (designated pages append at the end).',
  generated: 'Generated — assignments are final and read-only.',
}

export function EventBanner({ event }: { event: Event }) {
  return (
    <div className={`banner banner-${event.status}`}>
      <strong>{event.type} · {event.event_date}</strong>
      <span>{labels[event.status]}</span>
    </div>
  )
}
