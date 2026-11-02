'use client'
import { DenseFinancialTable } from '@/components/ui/DenseFinancialTable'

export function FontTableFixture() {
  return (
    <div style={{ padding: 24 }}>
      <DenseFinancialTable
        storageKey="font-195-fixture"
        columns={[{ key: '2024', label: '2024' }, { key: '2025', label: '2025' }]}
        rows={[
          { id: 'revenue', label: 'Revenue', values: { '2024': 1111111, '2025': 8888888 } },
          { id: 'gross_profit', label: 'Gross Profit', values: { '2024': 123456, '2025': 987654 } },
          { id: 'net_income', label: 'Net Income', values: { '2024': 1, '2025': 22222222 } },
          { id: 'eps', label: 'EPS', values: { '2024': 1234.5, '2025': 12 } },
        ]}
      />
    </div>
  )
}
