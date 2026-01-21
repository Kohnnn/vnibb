import type { NextConfig } from "next";
// @ts-expect-error - next-pwa doesn't have type declarations
import withPWA from "next-pwa";

const nextConfig: NextConfig = {
  // Enable Turbopack with empty config to silence the warning
  turbopack: {},
  
  // Disable TypeScript errors during builds for faster iteration
  typescript: {
    ignoreBuildErrors: false,
  },
  
  // Skip static generation for pages that require runtime data
  output: 'standalone',
};

// Wrap with PWA config for production builds
const config = withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === "development",
})(nextConfig);

export default config;
