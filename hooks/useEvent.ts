'use client'

import { useEffect, useState } from 'react'
import { useSupabase } from '@/lib/supabase'
import { Event } from '@/lib/types'

export function useEvent(eventId: string) {
  const supabase = useSupabase()
  const [event, setEvent] = useState<Event | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabase || !eventId) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) alert(error.message)
        else setEvent(data)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [supabase, eventId])

  return {
    event,
    loading: loading || !supabase,
    editable: event?.status === 'draft',
    locked: event?.status === 'locked',
    designatedLocked: event?.status === 'designated',
    generated: event?.status === 'generated',
  }
}
