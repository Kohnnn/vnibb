import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { QueryProvider } from "@/lib/QueryProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { DataSourcesProvider } from "@/contexts/DataSourcesContext";
import { UnitProvider } from "@/contexts/UnitContext";
import { WidgetGroupProvider } from "@/contexts/WidgetGroupContext";
import { SymbolLinkProvider } from "@/contexts/SymbolLinkContext";
import { ThemeProvider, ThemeScript } from "@/contexts/ThemeContext";
import { CommandPaletteWrapper } from "@/components/CommandPaletteWrapper";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VNIBB",
  description: "Vietnam stock market analytics dashboard",
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
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-[var(--bg-primary)] text-[var(--text-primary)]`}
        suppressHydrationWarning
      >
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-neutral-900 focus:px-4 focus:py-2 focus:text-white focus:ring-2 focus:ring-white"
        >
          Skip to main content
        </a>
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              <DashboardProvider>
                <WidgetGroupProvider>
                  <SymbolLinkProvider>
                    <DataSourcesProvider>
                      <UnitProvider>
                        <main id="main-content">{children}</main>
                        <CommandPaletteWrapper />
                      </UnitProvider>
                    </DataSourcesProvider>
                  </SymbolLinkProvider>
                </WidgetGroupProvider>
              </DashboardProvider>
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
