'use client'
import { FormEvent, Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const next = searchParams.get('next') || '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const supabase = createClient()
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (signInError) {
        setError(signInError.message)
        return
      }
      if (!data.user) {
        setError('Sign-in failed.')
        return
      }

      const { data: officer, error: officerError } = await supabase
        .from('officers')
        .select('user_id')
        .eq('user_id', data.user.id)
        .maybeSingle()

      if (officerError) {
        await supabase.auth.signOut()
        setError(officerError.message)
        return
      }
      if (!officer) {
        await supabase.auth.signOut()
        setError('This account is not authorized as a guild officer.')
        return
      }

      router.push(next)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="card login-card">
      <img src="/mondragon-icon.png" alt="" className="login-logo" width={72} height={72} />
      <h1>Officer Sign In</h1>
      <p className="muted">
        Guild auction tools are restricted to authorized officers. Discord check-in for members is unchanged.
      </p>
      <form onSubmit={onSubmit}>
        <label className="login-field">
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </label>
        <label className="login-field">
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="login-error">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </section>
  )
}

export default function LoginPage() {
  return (
    <main className="login-main">
      <Suspense fallback={<section className="card login-card"><p className="muted">Loading…</p></section>}>
        <LoginForm />
      </Suspense>
    </main>
  )
}
