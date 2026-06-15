import { Event } from '@/lib/types'

const labels: Record<Event['status'], string> = {
  draft: 'Draft — attendance, item totals, and auction pool can still be edited.',
  locked: 'Locked — roster is frozen. Generate allocation when ready.',
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
