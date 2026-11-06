import { notFound } from 'next/navigation'
import { FontTableFixture } from '@/app/fonts/zz-tmp-table-page'

// Dev-only fixture for the #195 font/tabular alignment Playwright check
// (apps/web/e2e/fonts.spec.ts). 404s in production builds.
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()
  return <FontTableFixture />
}
