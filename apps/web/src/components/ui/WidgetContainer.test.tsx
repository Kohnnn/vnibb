import { render, screen } from '@testing-library/react';
import { WidgetContainer, WidgetHeaderVisibilityProvider } from './WidgetContainer';

it('keeps a widget’s own actions available when the shared shell hides its header', () => {
  render(
    <WidgetHeaderVisibilityProvider hideHeader>
      <WidgetContainer title="Heatmap" headerActions={<button type="button">Group by sector</button>}>
        <p>Heatmap content</p>
      </WidgetContainer>
    </WidgetHeaderVisibilityProvider>,
  );

  expect(screen.getByRole('button', { name: 'Group by sector' })).toBeVisible();
  expect(screen.getByText('Heatmap content')).toBeVisible();
});
