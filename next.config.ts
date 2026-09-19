import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Default is 1MB. Document uploads (passport scans, certificates,
      // etc. — spec section 27) need more room; the actual per-file limit
      // enforced in src/lib/business/documents.ts is smaller (8MB) so this
      // just needs to comfortably exceed that plus form overhead.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
