import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'W8W9CollectionPortal',
  description: 'Tax-form readiness system of record: collect, validate, and keep current every payee W-9 and W-8 form before payment.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100 min-h-screen antialiased">{children}</body>
    </html>
  )
}
