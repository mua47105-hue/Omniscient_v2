import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Re-enabled type checking + strict mode (per Improvement Plan §8.1).
  // Previously ignoreBuildErrors:true shipped type errors to prod silently.
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: true,
};

export default nextConfig;
