import type { Metadata } from 'next'
import SettingsClient from '@/components/shell/SettingsClient'

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Configure data providers, API endpoints, and dashboard preferences for VniBB.',
  openGraph: {
    title: 'VniBB Settings',
    description: 'Configure data providers, API endpoints, and dashboard preferences for VniBB.',
    type: 'website',
  },
}

export default function SettingsPage() {
  return <SettingsClient />
}
