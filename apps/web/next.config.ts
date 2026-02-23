import type { NextConfig } from "next";
// @ts-expect-error - next-pwa doesn't have type declarations
import withPWA from "next-pwa";
import path from "node:path";

const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Pin the monorepo root to avoid lockfile root inference issues.
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  
  // Disable TypeScript errors during builds for faster iteration
  typescript: {
    ignoreBuildErrors: false,
  },
  
  // Enable standalone output only for production builds
  ...(isProduction ? { output: "standalone" } : {}),
};

// Wrap with PWA config for production builds
const config = withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
})(nextConfig);

export default config;
