import type { NextConfig } from 'next';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:4000';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  /**
   * Proxies /api/v1/* to the Nest API so the browser only ever sees one
   * origin (step 0.3 requirement C): no CORS config needed, and the API's
   * httpOnly auth cookies are same-origin from the browser's point of
   * view, so they're sent on every request without SameSite friction.
   */
  rewrites() {
    return Promise.resolve([
      { source: '/api/v1/:path*', destination: `${API_ORIGIN}/api/v1/:path*` },
    ]);
  },
};

export default nextConfig;
