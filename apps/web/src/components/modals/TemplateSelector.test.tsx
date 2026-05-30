import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateSelector } from './TemplateSelector';
import type { Dashboard } from '@/types/dashboard';

const currentDashboard: Dashboard = {
  id: 'dash-test',
  name: 'Test Dashboard',
  order: 0,
  isDefault: false,
  isEditable: true,
  isDeletable: true,
  showGroupLabels: true,
  tabs: [
    {
      id: 'tab-test',
      name: 'Main',
      order: 0,
      widgets: [
        {
          id: 'widget-test',
          type: 'price_chart',
          tabId: 'tab-test',
          config: { symbol: 'VCI' },
          layout: { i: 'widget-test', x: 0, y: 0, w: 12, h: 6 },
        },
      ],
    },
  ],
  syncGroups: [],
  createdAt: '2026-05-29T00:00:00.000Z',
  updatedAt: '2026-05-29T00:00:00.000Z',
};

describe('TemplateSelector', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps the dialog content on a higher layer than the backdrop', () => {
    render(
      <TemplateSelector
        open
        onClose={jest.fn()}
        onSelectTemplate={jest.fn()}
        currentDashboard={currentDashboard}
        currentSymbol="VCI"
      />
    );

    const backdrop = screen
      .getAllByLabelText('Close template selector')
      .find((element) => element.className.includes('absolute inset-0'));

    expect(backdrop).toHaveClass('z-0');
    expect(screen.getByRole('dialog')).toHaveClass('relative', 'z-10');
  });

  it('saves the current dashboard with visible feedback', async () => {
    const user = userEvent.setup();

    render(
      <TemplateSelector
        open
        onClose={jest.fn()}
        onSelectTemplate={jest.fn()}
        currentDashboard={currentDashboard}
        currentSymbol="VCI"
      />
    );

    await user.click(screen.getByRole('button', { name: /save current/i }));
    await user.type(screen.getByPlaceholderText('Template name'), 'QA Saved Layout');
    await user.click(screen.getByRole('button', { name: /save layout/i }));

    expect(screen.getByText('Saved "QA Saved Layout". It is ready under Your saved layouts.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'QA Saved Layout' })).toBeInTheDocument();
  });

  it('shows a non-destructive error when saved layouts cannot be written', async () => {
    const user = userEvent.setup();
    const setItemSpy = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    render(
      <TemplateSelector
        open
        onClose={jest.fn()}
        onSelectTemplate={jest.fn()}
        currentDashboard={currentDashboard}
        currentSymbol="VCI"
      />
    );

    await user.click(screen.getByRole('button', { name: /save current/i }));
    await user.type(screen.getByPlaceholderText('Template name'), 'Quota Layout');
    await user.click(screen.getByRole('button', { name: /save layout/i }));

    expect(screen.getByText('Saved layouts could not be written to this browser. Existing saved layouts were left unchanged.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Quota Layout' })).not.toBeInTheDocument();

    setItemSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
