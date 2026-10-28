import { render, screen, within } from '@testing-library/react'
import { DenseFinancialTable } from './DenseFinancialTable'

const columns = [
  { key: '2024', label: '2024' },
  { key: '2025', label: '2025' },
]

describe('financial comparison language and navigation', () => {
  test('keeps non-earnings changes signed and neutral without changing earnings arithmetic', () => {
    render(<DenseFinancialTable columns={columns} showTrend={false} rows={[
      { id: 'cost_of_revenue', label: 'Cost of Revenue', values: { '2024': -10, '2025': -15 } },
      { id: 'debt_to_equity', label: 'Debt/Equity', values: { '2024': 10, '2025': -5 } },
      { id: 'investing_cash_flow', label: 'Investing CF', values: { '2024': -10, '2025': 10 } },
      { id: 'asset_turnover', label: 'Asset Turnover', values: { '2024': -10, '2025': -5 } },
      { id: 'net_income', label: 'Net Income', values: { '2024': -10, '2025': -5 } },
    ]} />)

    for (const [name, change] of [
      ['Cost of Revenue', '-50.0%'],
      ['Debt/Equity', '-150.0%'],
      ['Investing CF', '+200.0%'],
      ['Asset Turnover', '+50.0%'],
    ]) {
      const row = screen.getByText(name).closest('tr')!
      expect(within(row).getByText(change)).toBeInTheDocument()
      expect(row).not.toHaveTextContent(/profit|loss/i)
      expect(within(row).getByText(change)).not.toHaveAttribute('title', expect.stringMatching(/profit|loss/i))
    }
    expect(screen.getByText('loss narrowed +50.0%')).toBeInTheDocument()
  })

  test('retains earnings narrowing, widening, crossings and break-even percentages', () => {
    render(<DenseFinancialTable columns={columns} showTrend={false} rows={[
      { id: 'net_income', label: 'Net Income', values: { '2024': -10, '2025': -15 } },
      { id: 'gross_profit', label: 'Gross Profit', values: { '2024': -10, '2025': 10 } },
      { id: 'operating_income', label: 'Operating Income', values: { '2024': 10, '2025': -5 } },
      { id: 'pre_tax_income', label: 'Pre-tax Income', values: { '2024': -10, '2025': 0 } },
      { id: 'eps', label: 'EPS', values: { '2024': 0, '2025': 10 } },
    ]} />)

    expect(screen.getByText('loss widened -50.0%')).toBeInTheDocument()
    expect(screen.getByText('to profit +200.0%')).toBeInTheDocument()
    expect(screen.getByText('to loss -150.0%')).toBeInTheDocument()
    expect(screen.getByText('loss narrowed +100.0%')).toBeInTheDocument()
    expect(screen.getByText('EPS').closest('tr')).not.toHaveTextContent('%')
  })

  test('exposes native scrolling as a focusable named region without hiding table semantics', () => {
    render(<DenseFinancialTable columns={columns} sortable={false} showTrend={false} rows={[
      { id: 'net_income', label: 'Net Income', values: { '2024': 10, '2025': 15 } },
    ]} />)

    const region = screen.getByRole('region', { name: /financial statement.*scroll/i })
    expect(region).toHaveAttribute('tabindex', '0')
    region.focus()
    expect(region).toHaveFocus()
    expect(within(region).getByRole('table')).toBeInTheDocument()
    expect(within(region).getByRole('columnheader', { name: '2024' })).toBeInTheDocument()
    expect(within(region).getByRole('columnheader', { name: '2025' })).toBeInTheDocument()
  })
})
