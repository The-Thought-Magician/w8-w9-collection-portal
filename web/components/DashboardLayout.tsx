'use client'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth/client'

interface NavItem {
  label: string
  href: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', href: '/dashboard' }],
  },
  {
    title: 'Payees & Forms',
    items: [
      { label: 'Payees', href: '/dashboard/payees' },
      { label: 'Forms', href: '/dashboard/forms' },
      { label: 'Validations', href: '/dashboard/validations' },
      { label: 'Exceptions', href: '/dashboard/exceptions' },
    ],
  },
  {
    title: 'Lifecycle',
    items: [
      { label: 'Expiry Clock', href: '/dashboard/expiry' },
      { label: 'Campaigns', href: '/dashboard/campaigns' },
      { label: 'Request Links', href: '/dashboard/links' },
      { label: 'Imports', href: '/dashboard/imports' },
    ],
  },
  {
    title: 'Compliance',
    items: [
      { label: 'Readiness Ledger', href: '/dashboard/readiness' },
      { label: 'Withholding', href: '/dashboard/withholding' },
      { label: 'Treaties', href: '/dashboard/treaties' },
      { label: 'Chapter 3/4', href: '/dashboard/chapters' },
      { label: 'B-Notices', href: '/dashboard/bnotices' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { label: 'Reports', href: '/dashboard/reports' },
      { label: 'Activity', href: '/dashboard/activity' },
      { label: 'Notifications', href: '/dashboard/notifications' },
    ],
  },
  {
    title: 'Account',
    items: [{ label: 'Settings', href: '/dashboard/settings' }],
  },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)
  const [workspace, setWorkspace] = useState('Workspace')
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const s = await authClient.getSession()
      if (cancelled) return
      if (!s?.data?.user) {
        router.push('/auth/sign-in')
        return
      }
      const user = s.data.user as { name?: string; email?: string }
      setWorkspace(user.name || user.email || 'Workspace')
      setChecking(false)
    })()
    return () => { cancelled = true }
  }, [router])

  useEffect(() => { setMobileOpen(false) }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <span className="inline-flex items-center gap-2 text-slate-400">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-yellow-400" />
          Loading workspace...
        </span>
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-4 py-6">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-500 text-sm font-black text-slate-950">W8</span>
        <span className="text-sm font-bold tracking-tight text-white">W8W9CollectionPortal</span>
      </Link>
      <div className="flex flex-col gap-6">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-600">
              {section.title}
            </div>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block rounded-full px-3.5 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-yellow-500 text-slate-950 shadow-sm shadow-yellow-500/20'
                          : 'text-slate-400 hover:bg-slate-800/70 hover:text-white'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="min-h-screen bg-slate-950">
      <aside className="fixed inset-y-0 left-0 hidden w-72 border-r border-slate-800/80 bg-slate-900/50 lg:block">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-slate-800 bg-slate-900">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-72">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
              aria-label="Open navigation"
            >
              ☰
            </button>
            <span className="text-sm text-slate-400">
              <span className="text-slate-600">Workspace</span>{' '}
              <span className="font-medium text-slate-200">{workspace}</span>
            </span>
          </div>
          <button
            onClick={signOut}
            className="rounded-full border border-slate-700 bg-slate-800 px-4 py-1.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-700"
          >
            Sign out
          </button>
        </header>
        <main className="px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  )
}
