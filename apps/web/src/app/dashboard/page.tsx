import type { Metadata } from 'next'
import DashboardClient from '@/components/shell/DashboardClient'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Track Vietnamese equities, financials, and market signals in one workspace.',
  openGraph: {
    title: 'VNIBB Dashboard',
    description: 'Track Vietnamese equities, financials, and market signals in one workspace.',
    type: 'website',
  },
}

export default function DashboardPage() {
  return <DashboardClient />
}
