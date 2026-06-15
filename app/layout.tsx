import './globals.css'
import type { Metadata } from 'next'
import { SiteNav } from '@/components/SiteNav'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Mondra ROOC · Guild Auction Planner',
  icons: {
    icon: '/mondragon-icon.png',
    apple: '/mondragon-icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <div className="site-bg" aria-hidden="true" />
        <SiteNav />
        {children}
      </body>
    </html>
  )
}
