/**
 * Signing out: this device stops getting the account's push notifications.
 * The browser keeps its subscription (whoever signs in next can turn push on
 * again); only the server side is switched off. Never throws.
 */
export async function releasePushForThisDevice(accessToken: string | null): Promise<void> {
  try {
    if (!accessToken || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
    // getRegistration(), not .ready: .ready never settles without a worker.
    const registration = await navigator.serviceWorker.getRegistration()
    const subscription = await registration?.pushManager?.getSubscription()
    if (!subscription) return
    await fetch('/api/notifications/push-token', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ token: JSON.stringify(subscription) }),
    })
  } catch {
    // Offline or unsupported: nothing more to do here.
  }
}
