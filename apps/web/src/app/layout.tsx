import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { QueryProvider } from "@/lib/QueryProvider";
import { AuthProvider } from "@/contexts/AuthContext";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { DataSourcesProvider } from "@/contexts/DataSourcesContext";
import { WidgetGroupProvider } from "@/contexts/WidgetGroupContext";
import { SymbolLinkProvider } from "@/contexts/SymbolLinkContext";
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
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-black text-white`}
        suppressHydrationWarning
      >
        <QueryProvider>
          <AuthProvider>
            <DashboardProvider>
              <WidgetGroupProvider>
                <SymbolLinkProvider>
                  <DataSourcesProvider>
                    {children}
                    <CommandPaletteWrapper />
                  </DataSourcesProvider>
                </SymbolLinkProvider>
              </WidgetGroupProvider>
            </DashboardProvider>
          </AuthProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
