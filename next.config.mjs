/** @type {import('next').NextConfig} */
const nextConfig = {
  // API-route-centric backend. Keep server-only packages out of client bundles.
  serverExternalPackages: ["pg", "googleapis"],
};

export default nextConfig;
