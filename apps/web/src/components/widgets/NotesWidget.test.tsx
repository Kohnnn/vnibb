import { act, fireEvent, render, screen } from '@testing-library/react';

import { NotesWidget } from './NotesWidget';
import { addNotebookItem, clearNotebook } from '@/lib/researchNotebook';

const updateWidget = jest.fn();
const setLinkedSymbol = jest.fn();

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({ updateWidget }),
}));
jest.mock('@/hooks/useWidgetSymbolLink', () => ({
  useWidgetSymbolLink: () => ({ setLinkedSymbol }),
}));
jest.mock('@/hooks/useDashboardWidget', () => ({
  useDashboardWidget: () => ({ dashboardId: 'dashboard', tabId: 'tab', widget: { config: {} } }),
}));
jest.mock('@/components/ui/WidgetMeta', () => ({
  WidgetMeta: () => null,
}));
jest.mock('@/lib/widgetRuntime', () => ({
  buildWidgetRuntime: jest.fn((value) => value),
}));

describe('NotesWidget evidence links', () => {
  beforeEach(() => {
    window.localStorage.clear();
    updateWidget.mockClear();
    setLinkedSymbol.mockClear();
  });

  afterEach(() => {
    act(() => clearNotebook());
  });

  it('attaches current-symbol notebook evidence and preserves missing evidence truthfully', () => {
    act(() => {
      addNotebookItem({
        kind: 'news',
        title: 'FPT source',
        symbol: 'FPT',
        sources: [{ label: 'VNIBB', url: 'https://example.test/fpt', asOf: '2026-07-20T00:00:00Z' }],
      });
    });

    const { rerender } = render(<NotesWidget id="notes" symbol="FPT" config={{}} />);
    fireEvent.change(screen.getByLabelText('Attach browser-local research evidence'), { target: { value: screen.getByRole('option', { name: 'FPT · FPT source' }).getAttribute('value') } });

    expect(screen.getByText('FPT source')).toBeInTheDocument();
    expect(screen.getByText(/VNIBB · 2026-07-20T00:00:00Z/)).toBeInTheDocument();

    rerender(<NotesWidget id="notes" symbol="FPT" config={{ thesesBySymbol: { FPT: { notebookItemIds: ['nb:missing'] } } }} />);
    expect(screen.getByText('Evidence unavailable or deleted: nb:missing')).toBeInTheDocument();
  });

  it('opens a due thesis through linked-symbol navigation', () => {
    render(<NotesWidget id="notes" symbol="FPT" config={{ thesesBySymbol: { vnm: { reviewDate: '2020-01-01', thesis: 'Review case' } } }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show theses due for review' }));
    fireEvent.click(screen.getByRole('button', { name: 'View due thesis for VNM' }));
    expect(setLinkedSymbol).toHaveBeenCalledWith('VNM');
  });
});
