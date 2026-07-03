import type { Metadata } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { AppProviders } from "@/contexts/AppProviders";
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

// Theme and UI preferences pre-hydration scripts
function ThemeUiScripts() {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function() {
              try {
                var storedTheme = localStorage.getItem('vnibb-theme');
                var resolved = (storedTheme === 'light' || storedTheme === 'dark') ? storedTheme : 'dark';
                document.documentElement.classList.remove('light', 'dark');
                document.documentElement.classList.add(resolved);
                document.documentElement.setAttribute('data-theme', resolved);
                
                var density = localStorage.getItem('vnibb-density');
                if (density === 'compact' || density === 'comfortable' || density === 'spacious') {
                  document.documentElement.setAttribute('data-density', density);
                }
                var chartStyle = localStorage.getItem('vnibb-chart-style-default');
                if (chartStyle) {
                  document.documentElement.setAttribute('data-chart-style', chartStyle);
                }
              } catch (e) {}
            })();
          `
        }}
        suppressHydrationWarning
      />
    </>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeUiScripts />
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
        <AppProviders>
          {children}
        </AppProviders>
      </body>
    </html>
  );
}
