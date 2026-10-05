import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["100.115.92.197"],
  // Research packages and historical validation snapshots never ship with a build.
  outputFileTracingExcludes: { "/*": ["./tmp/**/*"] },
};

export default nextConfig;
