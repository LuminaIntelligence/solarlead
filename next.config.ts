import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // unzipper uses optional @aws-sdk/client-s3 which webpack can't resolve.
  // Exclude it from bundling so Node.js loads it natively at runtime.
  serverExternalPackages: ["unzipper"],
};

export default nextConfig;
