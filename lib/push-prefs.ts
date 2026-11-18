// This browser's own push choices, kept in localStorage (never sent anywhere).
// "Off" is per device: Settings > Push off switches off this device only, so
// the app must not quietly turn it back on (components/push-prompt.tsx).

const OFF_KEY = 'togethr-push-off'
const SNOOZE_KEY = 'togethr-push-prompt-snoozed'
const SNOOZE_DAYS = 3

/** The person switched push off on this device on purpose. */
export function pushTurnedOffHere(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === '1'
  } catch {
    return false
  }
}

export function setPushOffHere(off: boolean): void {
  try {
    if (off) localStorage.setItem(OFF_KEY, '1')
    else localStorage.removeItem(OFF_KEY)
  } catch {
    /* not remembered */
  }
}

/** The "Turn on notifications" banner was closed recently. */
export function pushPromptSnoozed(): boolean {
  try {
    const at = Number(localStorage.getItem(SNOOZE_KEY))
    return at > 0 && Date.now() - at < SNOOZE_DAYS * 86_400_000
  } catch {
    return false
  }
}

export function snoozePushPrompt(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now()))
  } catch {
    /* not remembered */
  }
}
