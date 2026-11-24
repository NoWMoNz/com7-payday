import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // the dev-only "N" badge sits on top of the first tab in the bottom tab bar and swallows its taps; errors still show
  devIndicators: false,
};

export default nextConfig;
