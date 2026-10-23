/** @type {import('next').NextConfig} */
const nextConfig = {
  // Type errors fail the build (there are none; `npm run typecheck` checks).
  images: {
    unoptimized: true,
  },
  // Vercel doesn't reliably deploy dotfiles/dot-folders under /public (like
  // .well-known), so the static Digital Asset Links file 404s in production.
  // Route it to the API handler at app/api/assetlinks/route.ts instead.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          // Directives that can't break loading the app: no framing by other
          // sites, no <base> hijack, no plugins, forms post only here. A
          // script-src allowlist needs per-request nonces; not done yet.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; upgrade-insecure-requests",
          },
          // Location (sharing) and camera (photos) only for this site; nothing else.
          {
            key: "Permissions-Policy",
            value: "geolocation=(self), camera=(self), microphone=(), payment=(), usb=(), serial=(), bluetooth=()",
          },
        ],
      },
    ]
  },
  async rewrites() {
    return [
      {
        source: "/.well-known/assetlinks.json",
        destination: "/api/assetlinks",
      },
    ]
  },
}

export default nextConfig
