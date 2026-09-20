import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce .next/standalone for the multi-stage Docker image.
  output: "standalone",
};

export default nextConfig;
