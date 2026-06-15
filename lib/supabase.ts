'use client'

import { createClient } from '@/lib/supabase/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'

export function useSupabase(): SupabaseClient | null {
  const [client, setClient] = useState<SupabaseClient | null>(null)

  useEffect(() => {
    try {
      setClient(createClient())
    } catch (err) {
      console.error(err)
    }
  }, [])

  return client
}
