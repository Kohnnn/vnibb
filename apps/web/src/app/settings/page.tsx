import type { Metadata } from 'next'
import SettingsClient from '@/components/shell/SettingsClient'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Configure data providers, API endpoints, and dashboard preferences for VNIBB.',
  openGraph: {
    title: 'VNIBB Settings',
    description: 'Configure data providers, API endpoints, and dashboard preferences for VNIBB.',
    type: 'website',
  },
}

export default function SettingsPage() {
  return <SettingsClient />
}
