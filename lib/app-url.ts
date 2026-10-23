// The site's public address for links in emails, Stripe return URLs, calendar
// feeds and OAuth redirects. NEXT_PUBLIC_APP_URL wins; without it, production
// still links to mytogethr.com (never localhost or an old brand), and local
// development to the dev server.
export function appUrl(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "")
  if (configured) return configured
  return process.env.NODE_ENV === "production" ? "https://mytogethr.com" : "http://localhost:3000"
}
