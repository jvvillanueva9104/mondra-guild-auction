import { Event } from './types'

export function eventOpenHref(event: Event): string {
  if (event.status === 'generated') return `/events/${event.id}/results`
  if (event.status === 'designated') return `/events/${event.id}/generate`
  if (event.status === 'locked') return `/events/${event.id}/designated`
  return `/events/${event.id}/attendance`
}

export function isEventEditable(status: Event['status']): boolean {
  return status === 'draft'
}
