// Phone/desktop notifications the service worker showed (public/sw.js) stay in
// the tray, and on Android count toward the app icon's badge, until closed.
// Reading them in the app only updated the in-app list, so the badge went
// stale. These close the shown ones once they're read in the app.

interface Shown {
  data?: { notificationId?: unknown } | null
  close(): void
}

/** Which shown notifications to close: all of them, or those for the given in-app ids. */
export function shownToClose<T extends Shown>(shown: T[], ids?: Iterable<string>): T[] {
  if (!ids) return shown
  const set = new Set(ids)
  return shown.filter((n) => typeof n.data?.notificationId === 'string' && set.has(n.data.notificationId))
}

/** Close shown notifications: every one (no ids), or those for these in-app notification ids. */
export async function closeShownNotifications(ids?: Iterable<string>): Promise<void> {
  try {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg || typeof reg.getNotifications !== 'function') return
    for (const n of shownToClose(await reg.getNotifications(), ids)) n.close()
  } catch {
    // Best effort: a badge that stays is never worth an error.
  }
}

/**
 * Bring the tray in line with the in-app list: nothing unread closes all of
 * them; otherwise close the ones already read.
 */
export function syncShownNotifications(list: { id: string; isRead: boolean }[], unreadCount: number): Promise<void> {
  if (unreadCount === 0) return closeShownNotifications()
  return closeShownNotifications(list.filter((n) => n.isRead).map((n) => n.id))
}
