import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy", "/terms", "/delete-account", "/pricing"],
        disallow: ["/admin", "/api/"],
      },
    ],
  }
}
