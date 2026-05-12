/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
    // yahoo-finance2's ESM bundle pulls in dev-only test fixtures that webpack
    // can't resolve; marking it as a server external uses Node's require instead.
    serverComponentsExternalPackages: ["yahoo-finance2"],
  },
};

export default nextConfig;
