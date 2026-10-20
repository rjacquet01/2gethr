'use client'

import { useEffect, useState } from 'react'

// QR code for an otpauth:// URI, drawn in the browser so the TOTP secret never
// leaves it (no image service, no network request). Renders nothing while it
// is generating or if it fails; the link and manual key stay as fallback.
export function TotpQr({ otpAuthUrl }: { otpAuthUrl: string }) {
  // Keyed by the URI so a stale image is never shown for a new secret.
  const [qr, setQr] = useState<{ for: string; src: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    import('qrcode')
      .then((QRCode) => QRCode.toDataURL(otpAuthUrl, { width: 360, margin: 0, errorCorrectionLevel: 'M' }))
      .then((src) => { if (!cancelled) setQr({ for: otpAuthUrl, src }) })
      .catch(() => { if (!cancelled) setQr(null) })
    return () => { cancelled = true }
  }, [otpAuthUrl])

  const src = qr?.for === otpAuthUrl ? qr.src : null
  if (!src) return null
  return (
    // White padding keeps the quiet zone so it scans in dark mode too.
    <div className="w-fit rounded-lg bg-white p-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="QR code to add Togethr to your authenticator app" width={180} height={180} className="block h-[180px] w-[180px]" />
    </div>
  )
}
