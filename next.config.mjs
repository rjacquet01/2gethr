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
