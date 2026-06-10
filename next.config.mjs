/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // API-route-centric backend. Keep server-only packages out of client bundles.
  serverExternalPackages: ["better-sqlite3", "googleapis", "pg"],
  // Serve the static front-end (public/index.html) at the root, same-origin with
  // the /api/* routes it calls.
  async rewrites() {
    return [{ source: "/", destination: "/index.html" }];
  },
};

export default nextConfig;
