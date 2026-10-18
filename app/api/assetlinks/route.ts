import { NextResponse } from "next/server"

// Digital Asset Links verification for the Togethr TWA (Android) app.
//
// This is served through an API route instead of the static file at
// public/.well-known/assetlinks.json. That static file is committed to the
// repo and correct, but Vercel does not reliably deploy dotfiles/dot-folders
// (like `.well-known`) that live under /public — so the static path 404s in
// production even though the file exists in the repo. The rewrite in
// next.config.mjs maps /.well-known/assetlinks.json to this route so the
// content is served reliably regardless of that static-file quirk.
//
// If the signing key ever changes (e.g. re-keying the release keystore),
// update the fingerprint below to match the new certificate's SHA-256.
export async function GET() {
  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: "com.togethrapp.mobile",
          sha256_cert_fingerprints: [
            "47:0C:74:1D:D3:87:28:27:AC:EE:19:76:D2:8F:9D:23:D6:E7:5C:0C:80:AA:EB:10:E7:C8:7A:33:60:60:0F:87",
            // Play app signing key (keep in sync with public/.well-known/assetlinks.json)
            "9A:24:D4:24:42:A6:8B:24:EA:4E:B0:7D:8A:0C:F0:83:47:6C:FD:E6:B5:A2:AB:9E:BE:85:93:77:B6:AD:4B:78",
          ],
        },
      },
    ],
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    }
  )
}
