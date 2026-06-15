'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NavAuth } from '@/components/NavAuth'

export function SiteNav() {
  const pathname = usePathname()
  const isLogin = pathname.startsWith('/login')

  return (
    <nav className="site-nav">
      <Link href="/" className="nav-brand">
        <img src="/mondragon-icon.png" alt="" className="nav-logo" width={40} height={40} />
        <span>Mondra ROOC</span>
      </Link>
      {!isLogin && (
        <>
          <Link href="/">Events</Link>
          <Link href="/members">Members</Link>
          <NavAuth />
        </>
      )}
    </nav>
  )
}
