import { fireEvent, render, screen } from '@testing-library/react'

import { OnboardingWalkthrough } from '@/components/onboarding/OnboardingWalkthrough'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe('OnboardingWalkthrough', () => {
  beforeAll(() => {
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: jest.fn(),
    })

    Object.defineProperty(window, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: ResizeObserverMock,
    })
  })

  function renderWithAnchors(includeWidgetSettings = true) {
    return render(
      <>
        <div data-tour="sidebar-workspaces">sidebar</div>
        <div data-tour="header-bar">header</div>
        <div data-tour="tab-bar">tabs</div>
        {includeWidgetSettings ? <button data-tour="widget-settings-trigger">settings</button> : null}
        <OnboardingWalkthrough open onComplete={jest.fn()} />
      </>
    )
  }

  test('walks through the anchored dashboard steps', () => {
    renderWithAnchors()

    expect(screen.getByRole('dialog', { name: 'VNIBB walkthrough' })).toBeInTheDocument()
    expect(screen.getByText('Workspaces')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Header tools')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Tabs')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Widget settings')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('You are ready')).toBeInTheDocument()
  })

  test('skips the widget settings step when no widget anchor exists', () => {
    renderWithAnchors(false)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('You are ready')).toBeInTheDocument()
    expect(screen.queryByText('Widget settings')).not.toBeInTheDocument()
  })
})
