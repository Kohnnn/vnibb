// Flattened context provider tree
// Composes all providers in a single place for cleaner imports

'use client';

import { Suspense, type ReactNode } from 'react';
import { QueryProvider } from '@/lib/QueryProvider';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { UnitProvider } from '@/contexts/UnitContext';
import { DashboardProvider } from '@/contexts/DashboardContext';
import { WidgetGroupProvider } from '@/contexts/WidgetGroupContext';
import { SymbolLinkProvider } from '@/contexts/SymbolLinkContext';
import { GlobalMarketsSymbolProvider } from '@/contexts/GlobalMarketsSymbolContext';
import { AppProvider } from '@/contexts/AppContext';
import { DataSourcesProvider } from '@/contexts/DataSourcesContext';
import { UiPreferencesProvider } from '@/contexts/UiPreferencesContext';
import { CommandPaletteWrapper } from '@/components/CommandPaletteWrapper';
import { AnalyticsBootstrap } from '@/components/analytics/AnalyticsBootstrap';
import { AppToaster } from '@/components/ui/Toaster';
import { WidgetVisibilityProvider } from '@/hooks/useWidgetVisibility';
import { PredictionMarketWatchlistProvider } from '@/components/widgets/prediction-market-ui';

export interface AppProvidersProps {
    children: ReactNode;
    /**
     * Whether to enable the WidgetVisibilityProvider optimization.
     * Enable when inside the dashboard grid for single-observer optimization.
     * Disable when rendering outside the grid (e.g., modals, tooltips).
     */
    enableWidgetVisibilityOptimization?: boolean;
}

export function AppProviders({
    children,
    enableWidgetVisibilityOptimization = false,
}: AppProvidersProps) {
    return (
        <ThemeProvider>
            <UiPreferencesProvider>
                <UnitProvider>
                    <DataSourcesProvider>
                        <AppProvider>
                            <QueryProvider>
                                <AuthProvider>
                                    <DashboardProvider>
                                        <WidgetGroupProvider>
                                            <SymbolLinkProvider>
                                                <GlobalMarketsSymbolProvider>
                                                    {enableWidgetVisibilityOptimization ? (
                                                        <WidgetVisibilityProvider>
                                                            <PredictionMarketWatchlistProvider>
                                                                <ProvidersInner>{children}</ProvidersInner>
                                                            </PredictionMarketWatchlistProvider>
                                                        </WidgetVisibilityProvider>
                                                    ) : (
                                                        <PredictionMarketWatchlistProvider>
                                                            <ProvidersInner>{children}</ProvidersInner>
                                                        </PredictionMarketWatchlistProvider>
                                                    )}
                                                </GlobalMarketsSymbolProvider>
                                            </SymbolLinkProvider>
                                        </WidgetGroupProvider>
                                    </DashboardProvider>
                                </AuthProvider>
                            </QueryProvider>
                        </AppProvider>
                    </DataSourcesProvider>
                </UnitProvider>
            </UiPreferencesProvider>
        </ThemeProvider>
    );
}

// Inner providers that don't need widget visibility context
function ProvidersInner({ children }: { children: ReactNode }) {
    return (
        <>
            <Suspense fallback={null}>
                <AnalyticsBootstrap />
            </Suspense>
            <main id="main-content">{children}</main>
            <CommandPaletteWrapper />
            <AppToaster />
        </>
    );
}

// Re-export individual providers for targeted usage
export { QueryProvider } from '@/lib/QueryProvider';
export { AuthProvider } from '@/contexts/AuthContext';
export { ThemeProvider } from '@/contexts/ThemeContext';
export { UnitProvider } from '@/contexts/UnitContext';
export { DashboardProvider } from '@/contexts/DashboardContext';
export { WidgetGroupProvider } from '@/contexts/WidgetGroupContext';
export { SymbolLinkProvider } from '@/contexts/SymbolLinkContext';
export { GlobalMarketsSymbolProvider } from '@/contexts/GlobalMarketsSymbolContext';
export { AppProvider } from '@/contexts/AppContext';
export { DataSourcesProvider } from '@/contexts/DataSourcesContext';
export { UiPreferencesProvider } from '@/contexts/UiPreferencesContext';
