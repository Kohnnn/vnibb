import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TemplateSelector } from './TemplateSelector';

it('applies Company Research from the picker without starting a copilot workflow', async () => {
  const user = userEvent.setup();
  const onSelectTemplate = jest.fn();
  const onClose = jest.fn();
  const onStarterPromptRequest = jest.fn();

  render(
    <TemplateSelector
      open
      currentSymbol="HPG"
      onSelectTemplate={onSelectTemplate}
      onClose={onClose}
      onStarterPromptRequest={onStarterPromptRequest}
    />
  );

  const picker = within(screen.getByRole('dialog', { name: /dashboard templates/i }));
  await user.type(picker.getByRole('textbox'), 'Company Research');
  expect(onSelectTemplate).not.toHaveBeenCalled();
  const card = picker.getByRole('article');
  expect(within(card).getByRole('heading', { name: /company research/i })).toBeVisible();
  await user.click(within(card).getByRole('button', { name: /use template/i }));

  expect(onSelectTemplate).toHaveBeenCalledTimes(1);
  expect(onSelectTemplate).toHaveBeenCalledWith(expect.objectContaining({
    id: 'company-research',
    widgets: [
      expect.objectContaining({ type: 'ticker_info' }),
      expect.objectContaining({ type: 'price_chart' }),
      expect.objectContaining({ type: 'unified_financials' }),
      expect.objectContaining({ type: 'news_feed' }),
      expect.objectContaining({ type: 'events_calendar' }),
    ],
  }));
  expect(onStarterPromptRequest).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalledTimes(1);
});
