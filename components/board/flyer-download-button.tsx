'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { authFetch } from '@/hooks/use-auth'

// Save a flyer to this device. Phones that can share files get the system
// share sheet ("Save image", Photos, Files...). Everything else, including
// the Android app's web view, follows a plain link to the download route,
// which answers with Content-Disposition: attachment so the browser's own
// download handling saves it.
export function FlyerDownloadButton({ url }: { url: string }) {
  const [busy, setBusy] = useState(false)

  const download = async (e: React.MouseEvent<HTMLAnchorElement>) => {
    const nav = typeof navigator !== 'undefined' ? navigator : null
    if (!nav?.canShare || !/Android|iPhone|iPad|iPod/i.test(nav.userAgent)) return // the link downloads
    e.preventDefault()
    setBusy(true)
    try {
      const res = await authFetch(url)
      if (!res.ok) throw new Error('download failed')
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'togethr-flyer.jpg'
      const blob = await res.blob()
      const file = new File([blob], name, { type: blob.type || 'image/jpeg' })
      if (nav.canShare({ files: [file] })) {
        await nav.share({ files: [file] })
      } else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(file)
        a.download = name
        a.click()
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      }
    } catch (err) {
      // Closing the share sheet is not an error.
      if ((err as Error)?.name !== 'AbortError') toast.error('Could not download the flyer')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Button size="sm" variant="outline" asChild>
      <a href={url} download onClick={download} aria-disabled={busy}>
        {busy ? <Spinner className="mr-1.5 h-4 w-4" /> : <Download className="mr-1.5 h-4 w-4" />}
        Download
      </a>
    </Button>
  )
}
