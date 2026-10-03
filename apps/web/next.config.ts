import type { NextConfig } from "next";
import createBundleAnalyzer from "@next/bundle-analyzer";
import path from "node:path";
// @ts-expect-error - next-pwa doesn't have type declarations
import withPWA from "next-pwa";
// @ts-expect-error - next-pwa/cache doesn't have type declarations
import defaultCache from "next-pwa/cache";

/**
 * Private research shares must never be served from cache: snapshots are
 * recipient-only, owner-revocable and expire. The stock next-pwa defaults
 * route same-origin /api/* (and cross-origin) GETs through NetworkFirst, so a
 * revoked share's frozen bundle could be replayed offline. This rule must
 * precede every default rule (first match wins) and deliberately omits the
 * origin check so it also covers a cross-origin API host (sslip.io).
 *
 * The rule's regex is inlined (not hoisted to a module constant) so Workbox
 * can serialize it into the generated sw.js without a closure.
 */
const runtimeCaching = [
  {
    urlPattern: ({ url }: { url: URL }) => /\/research-shares(\/|$)/.test(url.pathname),
    handler: "NetworkOnly",
    method: "GET",
  },
  ...defaultCache,
];

const isDev = process.env.NODE_ENV === "development";
const withBundleAnalyzer = createBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

const nextConfig: NextConfig = {
  // Pin the monorepo root to avoid lockfile root inference issues.
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },

  // TypeScript errors fail the build (do not set ignoreBuildErrors: true)
  typescript: {
    ignoreBuildErrors: false,
  },

  // Enable standalone output only for production builds
  ...(process.env.NODE_ENV === "production" ? { output: "standalone" } : {}),
};

const config = withBundleAnalyzer(withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: isDev,
  runtimeCaching,
  importScripts: ["/private-share-cache.js"],
})(nextConfig));

export default config;