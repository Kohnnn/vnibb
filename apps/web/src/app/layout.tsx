import type { Metadata } from "next";
import localFont from "next/font/local";
import { Suspense } from "react";
import { AppProviders } from "@/contexts/AppProviders";
import "./globals.css";

/* Self-hosted brand fonts (OFL; licenses beside the files). Variables mount on
   <html> so the :root tokens in design-tokens.css can resolve them. */
const inter = localFont({
  src: [
    { path: "./fonts/Inter-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Inter-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Inter-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Inter-Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
  fallback: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
});

const plexMono = localFont({
  src: "./fonts/IBMPlexMono-Regular.ttf",
  variable: "--font-plex-mono",
  display: "swap",
  weight: "400",
  fallback: ["monospace"],
});

/**
 * Canonical origin. Preview deployments and localhost must not advertise
 * themselves as canonical, so only the production host is pinned; every other
 * environment keeps Next's per-request origin.
 */
export const VNIBB_CANONICAL_ORIGIN = "https://web.vnibb.xyz";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || VNIBB_CANONICAL_ORIGIN;

const SITE_DESCRIPTION =
  "VniBB is a research cockpit for Vietnamese equities: financial statements, ratios, charts and market intelligence in one modular workspace.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "VniBB | Research cockpit for Vietnamese equities",
  description: SITE_DESCRIPTION,
  applicationName: "VniBB",
  manifest: "/manifest.json",
  alternates: { canonical: "/" },
  openGraph: {
    title: "VniBB | Research cockpit for Vietnamese equities",
    description: SITE_DESCRIPTION,
    type: "website",
    url: "/",
    siteName: "VniBB",
    locale: "en_US",
    images: [
      {
        url: "/brand/og-vnibb.png",
        width: 1200,
        height: 630,
        alt: "VniBB wordmark on the brand plate",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VniBB | Research cockpit for Vietnamese equities",
    description: SITE_DESCRIPTION,
    images: ["/brand/og-vnibb.png"],
  },
  /* Favicon/app-icon artwork is not in the brand pack and needs approval;
     Next keeps serving the existing /favicon.ico until that lands. */
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
                // Color-vision and reduce-effects must apply before first paint,
                // otherwise the initial frame shows the default palette.
                if (localStorage.getItem('vnibb-colorblind-mode') === 'true') {
                  document.documentElement.setAttribute('data-color-mode', 'colorblind');
                }
                if (localStorage.getItem('vnibb-reduce-effects') === 'true') {
                  document.documentElement.setAttribute('data-reduce-effects', 'true');
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
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${plexMono.variable}`}
    >
      <head>
        <ThemeUiScripts />
      </head>
      <body
        className="antialiased bg-[var(--bg-primary)] text-[var(--text-primary)]"
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
