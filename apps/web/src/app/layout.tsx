<<<<<<< Updated upstream
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { QueryProvider } from "@/lib/QueryProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { DataSourcesProvider } from "@/contexts/DataSourcesContext";
import { UnitProvider } from "@/contexts/UnitContext";
import { WidgetGroupProvider } from "@/contexts/WidgetGroupContext";
import { SymbolLinkProvider } from "@/contexts/SymbolLinkContext";
import { GlobalMarketsSymbolProvider } from "@/contexts/GlobalMarketsSymbolContext";
import { ThemeProvider, ThemeScript } from "@/contexts/ThemeContext";
import { UiPreferencesProvider, UiPreferencesScript } from "@/contexts/UiPreferencesContext";
import { CommandPaletteWrapper } from "@/components/CommandPaletteWrapper";
import { AnalyticsBootstrap } from "@/components/analytics/AnalyticsBootstrap";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/Geist-Variable.ttf",
  variable: "--font-geist-sans",
  display: "swap",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.ttf",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "VNIBB",
  description: "Vietnam stock market analytics dashboard",
  openGraph: {
    title: "VNIBB",
    description: "Vietnam stock market analytics dashboard",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <UiPreferencesScript />
        <title>VNIBB | Vietnam Stock Market Analytics</title>
        <meta
          name="description"
          content="Vietnam-first stock market analytics dashboard with financial statements, ratios, charts, and market intelligence."
        />
        <meta property="og:title" content="VNIBB | Vietnam Stock Market Analytics" />
        <meta
          property="og:description"
          content="Vietnam-first stock market analytics dashboard with financial statements, ratios, charts, and market intelligence."
        />
        <meta property="og:type" content="website" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[var(--bg-primary)] text-[var(--text-primary)]`}
        suppressHydrationWarning
      >
        <a
          href="#main-content"
          className="skip-to-main-link"
        >
          Skip to main content
        </a>
        <ThemeProvider>
          <UiPreferencesProvider>
            <QueryProvider>
              <AuthProvider>
                <DashboardProvider>
                  <WidgetGroupProvider>
                    <SymbolLinkProvider>
                      <GlobalMarketsSymbolProvider>
                        <DataSourcesProvider>
                          <UnitProvider>
                            <Suspense fallback={null}>
                              <AnalyticsBootstrap />
                            </Suspense>
                            <main id="main-content">{children}</main>
                            <CommandPaletteWrapper />
                          </UnitProvider>
                        </DataSourcesProvider>
                      </GlobalMarketsSymbolProvider>
                    </SymbolLinkProvider>
                  </WidgetGroupProvider>
                </DashboardProvider>
              </AuthProvider>
            </QueryProvider>
          </UiPreferencesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
=======
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { QueryProvider } from "@/lib/QueryProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { DataSourcesProvider } from "@/contexts/DataSourcesContext";
import { UnitProvider } from "@/contexts/UnitContext";
import { WidgetGroupProvider } from "@/contexts/WidgetGroupContext";
import { SymbolLinkProvider } from "@/contexts/SymbolLinkContext";
import { GlobalMarketsSymbolProvider } from "@/contexts/GlobalMarketsSymbolContext";
import { ThemeProvider, ThemeScript } from "@/contexts/ThemeContext";
import { UiPreferencesProvider, UiPreferencesScript } from "@/contexts/UiPreferencesContext";
import { CommandPaletteWrapper } from "@/components/CommandPaletteWrapper";
import { AnalyticsBootstrap } from "@/components/analytics/AnalyticsBootstrap";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/Geist-Variable.ttf",
  variable: "--font-geist-sans",
  display: "swap",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMono-Variable.ttf",
  variable: "--font-geist-mono",
  display: "swap",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "VNIBB",
  description: "Vietnam stock market analytics dashboard",
  openGraph: {
    title: "VNIBB",
    description: "Vietnam stock market analytics dashboard",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <UiPreferencesScript />
        <title>VNIBB | Vietnam Stock Market Analytics</title>
        <meta
          name="description"
          content="Vietnam-first stock market analytics dashboard with financial statements, ratios, charts, and market intelligence."
        />
        <meta property="og:title" content="VNIBB | Vietnam Stock Market Analytics" />
        <meta
          property="og:description"
          content="Vietnam-first stock market analytics dashboard with financial statements, ratios, charts, and market intelligence."
        />
        <meta property="og:type" content="website" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[var(--bg-primary)] text-[var(--text-primary)]`}
        suppressHydrationWarning
      >
        <a
          href="#main-content"
          className="skip-to-main-link"
        >
          Skip to main content
        </a>
        <ThemeProvider>
          <UiPreferencesProvider>
            <QueryProvider>
              <AuthProvider>
                <DashboardProvider>
                  <WidgetGroupProvider>
                    <SymbolLinkProvider>
                      <GlobalMarketsSymbolProvider>
                        <DataSourcesProvider>
                          <UnitProvider>
                            <Suspense fallback={null}>
                              <AnalyticsBootstrap />
                            </Suspense>
                            <main id="main-content">{children}</main>
                            <CommandPaletteWrapper />
                          </UnitProvider>
                        </DataSourcesProvider>
                      </GlobalMarketsSymbolProvider>
                    </SymbolLinkProvider>
                  </WidgetGroupProvider>
                </DashboardProvider>
              </AuthProvider>
            </QueryProvider>
          </UiPreferencesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
>>>>>>> Stashed changes
