import type { NextConfig } from "next";
// @ts-expect-error - next-pwa doesn't have type declarations
import withPWA from "next-pwa";

const isProduction = process.env.NODE_ENV === "production";

const nextConfig: NextConfig = {
  // Enable Turbopack with empty config to silence the warning
  turbopack: {},
  
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
