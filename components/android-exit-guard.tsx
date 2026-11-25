'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { toast } from 'sonner'
import { usePurchaseUi } from '@/hooks/use-purchase-ui'

// In the Android app, the Back button on the Home screen closes the app at
// once. A tester asked for a confirmation, so the first Back shows "Press back
// again to exit" and the second one (within a few seconds) leaves. Only on
// Home, only inside the Android app; the website is untouched.
//
// It works with a marker entry in the history: Back lands on the page itself,
// we show the hint and put the marker back, and a second Back within the window
// goes one step further, which closes the app.
const WINDOW_MS = 2500
const MARK = 'togethrExitGuard'

export function AndroidExitGuard() {
  const pathname = usePathname()
  const { isAndroidApp } = usePurchaseUi()
  const active = isAndroidApp && pathname === '/dashboard'

  useEffect(() => {
    if (!active) return
    // The app window (a Trusted Web Activity) reports standalone. The same
    // cookie also exists in Chrome on that phone, where Back should stay normal.
    if (!window.matchMedia('(display-mode: standalone)').matches) return
    let armed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const mark = () => {
      try {
        // Keep Next's own state so its router still recognises the entry.
        window.history.pushState({ ...(window.history.state || {}), [MARK]: true }, '')
      } catch {
        // No history access: the guard simply isn't active.
      }
    }

    // Coming back to Home through a marked entry must not add a second marker.
    if (!(window.history.state && window.history.state[MARK])) mark()

    const onPop = () => {
      if (armed) {
        armed = false
        if (timer) clearTimeout(timer)
        window.history.back()
        return
      }
      armed = true
      toast('Press back again to exit', { duration: WINDOW_MS })
      mark()
      timer = setTimeout(() => { armed = false }, WINDOW_MS)
    }

    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (timer) clearTimeout(timer)
    }
  }, [active])

  return null
}
