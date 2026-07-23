/**
 * No-throw mount smoke test for every registered widget.
 *
 * The sibling WidgetRegistry.test.ts pins that every catalogue ID resolves to
 * a component module (catches import-time throws). It does NOT mount anything,
 * so a widget that crashes during its first render — reading `foo.bar` on
 * undefined data, calling a browser API missing in jsdom, throwing in a hook —
 * ships undetected. This test mounts each non-placeholder widget in its initial
 * (loading) state and asserts none of them throw synchronously on mount.
 *
 * Scope is deliberately narrow: no per-widget fixtures and no content
 * assertions. `fetch` is stubbed to a never-settling promise so every
 * data-driven widget stays in its loading branch, and the whole tree is wrapped
 * in a QueryClientProvider + Suspense + ErrorBoundary. A tripped boundary is the
 * signal of a mount-time crash.
 */

import * as React from 'react';
import { act, render } from '@testing-library/react';

import { widgetRegistry } from './WidgetRegistry';
import { QueryProvider } from '@/lib/QueryProvider';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { UiPreferencesProvider } from '@/contexts/UiPreferencesContext';
import { UnitProvider } from '@/contexts/UnitContext';
import { DataSourcesProvider } from '@/contexts/DataSourcesContext';
import { AppProvider } from '@/contexts/AppContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { DashboardProvider } from '@/contexts/DashboardContext';
import { WidgetGroupProvider } from '@/contexts/WidgetGroupContext';
import { SymbolLinkProvider } from '@/contexts/SymbolLinkContext';
import { GlobalMarketsSymbolProvider } from '@/contexts/GlobalMarketsSymbolContext';
import { PredictionMarketWatchlistProvider } from '@/components/widgets/prediction-market-ui';

// Mirror AppProviders' context tree (see contexts/AppProviders.tsx) WITHOUT the
// side-effect chrome in ProvidersInner (CommandPalette / Toaster / Analytics),
// which is irrelevant to a widget mount and would only add noise. Composed via
// reduce so the nesting order is data-driven and cheap to keep in sync.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- provider props vary (some declare `readonly children`); this helper only needs them callable as wrappers.
const CONTEXT_PROVIDERS: React.ComponentType<any>[] = [
    ThemeProvider,
    UiPreferencesProvider,
    UnitProvider,
    DataSourcesProvider,
    AppProvider,
    QueryProvider,
    AuthProvider,
    DashboardProvider,
    WidgetGroupProvider,
    SymbolLinkProvider,
    GlobalMarketsSymbolProvider,
    PredictionMarketWatchlistProvider,
];

function TestProviders({ children }: { children: React.ReactNode }) {
    return CONTEXT_PROVIDERS.reduceRight(
        (tree, Provider) => <Provider>{tree}</Provider>,
        children as React.ReactElement
    );
}

class MountErrorBoundary extends React.Component<
    { children: React.ReactNode; onError: (error: Error) => void },
    { hasError: boolean }
> {
    state = { hasError: false };

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error: Error) {
        this.props.onError(error);
    }

    render() {
        return this.state.hasError ? null : this.props.children;
    }
}

describe('WidgetRegistry mount smoke test', () => {
    const originalFetch = globalThis.fetch;

    beforeAll(() => {
        // Keep every data-driven widget parked in its loading state so we only
        // exercise the initial render path, never resolved/empty-data branches.
        globalThis.fetch = jest.fn(() => new Promise(() => {})) as unknown as typeof fetch;
    });

    afterAll(() => {
        globalThis.fetch = originalFetch;
    });

    const entries = Array.from(widgetRegistry.entries()).filter(
        ([, entry]) => !entry.isPlaceholder
    );

    it('has widgets to smoke test', () => {
        expect(entries.length).toBeGreaterThan(0);
    });

    it.each(entries)('mounts %s without throwing', async (type, entry) => {
        const errors: Error[] = [];
        const Widget = entry.component;

        await act(async () => {
            render(
                <TestProviders>
                    <MountErrorBoundary onError={(e) => errors.push(e)}>
                        <React.Suspense fallback={null}>
                            <Widget id={`smoke-${String(type)}`} symbol="VNM" />
                        </React.Suspense>
                    </MountErrorBoundary>
                </TestProviders>
            );
            // Flush the lazy import so the real component renders (not fallback).
            await entry.lazyComponent();
        });

        if (errors.length > 0) {
            throw new Error(
                `Widget "${String(type)}" threw on mount: ${errors[0].message}`
            );
        }
    });
});
