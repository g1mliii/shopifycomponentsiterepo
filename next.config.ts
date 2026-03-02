import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  allowedDevOrigins: ["http://127.0.0.1:3000", "http://localhost:3000"],
};

export default nextConfig;
