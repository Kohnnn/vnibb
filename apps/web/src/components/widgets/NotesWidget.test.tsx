import { act, fireEvent, render, screen } from '@testing-library/react';

import { NotesWidget } from './NotesWidget';
import { addNotebookItem, clearNotebook } from '@/lib/researchNotebook';

const updateWidget = jest.fn();
const setLinkedSymbol = jest.fn();
let mockDashboards: Array<Record<string, unknown>> = [];

jest.mock('@/contexts/DashboardContext', () => ({
  useDashboard: () => ({ updateWidget, state: { dashboards: mockDashboards } }),
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

jest.mock('@/lib/analytics', () => ({
  ANALYTICS_EVENTS: { thesisCompleted: 'thesis_completed' },
  captureAnalyticsEvent: jest.fn(),
}));

describe('NotesWidget evidence links', () => {
  beforeEach(() => {
    window.localStorage.clear();
    updateWidget.mockClear();
    setLinkedSymbol.mockClear();
    mockDashboards = [];
    (jest.requireMock('@/lib/analytics').captureAnalyticsEvent as jest.Mock).mockClear();
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

  it('records one metadata-only event when a thesis is completed', () => {
    act(() => {
      addNotebookItem({ kind: 'news', title: 'FPT source', symbol: 'FPT' });
    });

    render(<NotesWidget id="notes" symbol="FPT" config={{}} />);
    fireEvent.change(screen.getByLabelText('Review date'), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText('Thesis'), { target: { value: 'Durable earnings growth' } });
    fireEvent.change(screen.getByLabelText('Catalysts'), { target: { value: 'New capacity' } });
    fireEvent.change(screen.getByLabelText('Risks'), { target: { value: 'Execution risk' } });
    fireEvent.change(screen.getByLabelText('Invalidation'), { target: { value: 'Margin falls below target' } });
    fireEvent.change(screen.getByLabelText('Attach browser-local research evidence'), { target: { value: screen.getByRole('option', { name: 'FPT · FPT source' }).getAttribute('value') } });
    fireEvent.click(screen.getByRole('button', { name: 'Save thesis' }));

    const analyticsEvent = jest.requireMock('@/lib/analytics').captureAnalyticsEvent as jest.Mock;
    expect(analyticsEvent).toHaveBeenCalledWith('thesis_completed', {
      source: 'notes_widget',
      evidence_attached: true,
      review_date_set: true,
    });
    expect(analyticsEvent.mock.calls[0][1]).not.toHaveProperty('symbol');
    expect(analyticsEvent.mock.calls[0][1]).not.toHaveProperty('thesis');
  });

  it('does not complete a thesis without available linked evidence', () => {
    render(<NotesWidget id="notes" symbol="FPT" config={{ thesesBySymbol: { FPT: { notebookItemIds: ['nb:missing'] } } }} />);
    fireEvent.change(screen.getByLabelText('Review date'), { target: { value: '2026-12-31' } });
    fireEvent.change(screen.getByLabelText('Thesis'), { target: { value: 'Durable earnings growth' } });
    fireEvent.change(screen.getByLabelText('Catalysts'), { target: { value: 'New capacity' } });
    fireEvent.change(screen.getByLabelText('Risks'), { target: { value: 'Execution risk' } });
    fireEvent.change(screen.getByLabelText('Invalidation'), { target: { value: 'Margin falls below target' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save thesis' }));

    expect((jest.requireMock('@/lib/analytics').captureAnalyticsEvent as jest.Mock)).not.toHaveBeenCalled();
  });

  it('opens a due thesis saved in another notes widget', () => {
    mockDashboards = [{
      tabs: [{
        widgets: [{
          id: 'other-notes',
          type: 'notes',
          config: { thesesBySymbol: { vnm: { reviewDate: '2020-01-01', thesis: 'Review case' } } },
        }],
      }],
    }];

    render(<NotesWidget id="notes" symbol="FPT" config={{}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show theses due for review' }));
    fireEvent.click(screen.getByRole('button', { name: 'View due thesis for VNM' }));
    expect(setLinkedSymbol).toHaveBeenCalledWith('VNM');
  });
});
