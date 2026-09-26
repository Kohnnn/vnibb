import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateSelector } from './TemplateSelector';
import { getStarterForTemplate } from '@/lib/researchStarters';
import { DASHBOARD_TEMPLATES } from '@/types/dashboard-templates';
import type { Dashboard } from '@/types/dashboard';
import type { WidgetGroupId } from '@/types/widget';

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

  const fundamentalTemplate = () => {
    const template = DASHBOARD_TEMPLATES.find((item) => item.id === 'fundamental-analyst');
    if (!template) throw new Error('fundamental-analyst template is missing');
    return template;
  };

  const noStarterTemplate = () => {
    const template = DASHBOARD_TEMPLATES.find((item) => !getStarterForTemplate(item.id));
    if (!template) throw new Error('no starter-free template is available');
    return template;
  };

  /**
   * A starter-bound template can appear both in the recommendations row and in
   * the main grid, so the card is located structurally instead of by heading.
   */
  const findTemplateCard = (templateName: string): HTMLElement => {
    const card = screen
      .getAllByRole('article')
      .find((element) => within(element).queryByRole('heading', { name: templateName }));
    if (!card) throw new Error(`template card not found: ${templateName}`);
    return card;
  };

  it('primes the copilot with the starter prompt key before applying a starter template', async () => {
    const user = userEvent.setup();
    const onSelectTemplate = jest.fn();
    const onStarterPromptRequest = jest.fn();
    const onClose = jest.fn();
    const template = fundamentalTemplate();
    const starter = getStarterForTemplate(template.id);

    render(
      <TemplateSelector
        open
        onClose={onClose}
        onSelectTemplate={onSelectTemplate}
        onStarterPromptRequest={onStarterPromptRequest}
        sharedTickerGroups={[]}
        currentDashboard={currentDashboard}
        currentSymbol="VCI"
      />
    );

    expect(onStarterPromptRequest).not.toHaveBeenCalled();
    expect(onSelectTemplate).not.toHaveBeenCalled();

    const card = findTemplateCard(template.name);
    await user.click(within(card).getByRole('button', { name: /use template/i }));

    // The workspace is untouched until the user confirms the disclosure.
    expect(onSelectTemplate).not.toHaveBeenCalled();
    const disclosure = screen.getByRole('dialog', { name: starter?.name ?? '' });
    expect(disclosure).toHaveTextContent(starter?.purpose ?? '');
    expect(disclosure).toHaveTextContent('keep their own tickers until you link a group');

    await user.click(within(disclosure).getByRole('button', { name: new RegExp(`apply ${template.name}`, 'i') }));

    expect(onStarterPromptRequest).toHaveBeenCalledTimes(1);
    expect(onStarterPromptRequest).toHaveBeenCalledWith(starter?.promptKey);
    expect(onSelectTemplate).toHaveBeenCalledWith(template);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('leaves the copilot untouched when the applied template has no starter', async () => {
    const user = userEvent.setup();
    const onSelectTemplate = jest.fn();
    const onStarterPromptRequest = jest.fn();
    const template = noStarterTemplate();

    render(
      <TemplateSelector
        open
        onClose={jest.fn()}
        onSelectTemplate={onSelectTemplate}
        onStarterPromptRequest={onStarterPromptRequest}
        sharedTickerGroups={[]}
        currentDashboard={currentDashboard}
        currentSymbol="VCI"
      />
    );

    const card = findTemplateCard(template.name);
    await user.click(within(card).getByRole('button', { name: /use template/i }));

    expect(onSelectTemplate).toHaveBeenCalledWith(template);
    expect(onStarterPromptRequest).not.toHaveBeenCalled();
  });

  it('names the ticker group when the applied workspace really shares one', async () => {
    const user = userEvent.setup();
    const template = fundamentalTemplate();
    const starter = getStarterForTemplate(template.id);
    if (!starter) throw new Error('fundamental-analyst starter is missing');

    render(
      <TemplateSelector
        open
        onClose={jest.fn()}
        onSelectTemplate={jest.fn()}
        onStarterPromptRequest={jest.fn()}
        sharedTickerGroups={['global'] as readonly WidgetGroupId[]}
        currentDashboard={currentDashboard}
        currentSymbol="VCI"
      />
    );

    const card = findTemplateCard(template.name);
    await user.click(within(card).getByRole('button', { name: /use template/i }));

    expect(screen.getByRole('dialog', { name: starter.name })).toHaveTextContent(
      `${starter.name} seeds this workspace with widgets that share the global ticker.`,
    );
  });
});
