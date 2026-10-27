import type Stripe from "stripe"
import { ddl } from "./schema-snapshot"

// A subscription set to end later. Stripe shows it two ways: classic billing
// mode sets cancel_at_period_end (and cancel_at to the period end); flexible
// billing mode, which the customer portal uses on newer API versions, sets
// only cancel_at and leaves cancel_at_period_end false. Reading just
// cancel_at_period_end missed portal cancellations entirely.

type CancelFields = Pick<Stripe.Subscription, "status" | "cancel_at" | "cancel_at_period_end"> & {
  items?: { data: Array<Pick<Stripe.SubscriptionItem, "current_period_end">> }
}

export interface PendingCancel {
  /** The subscription will end on a future date unless it is resumed. */
  pending: boolean
  /** When it ends (ISO), or null when nothing is pending. */
  endsAt: string | null
}

const iso = (seconds: number) => new Date(seconds * 1000).toISOString()

export function pendingCancelFrom(sub: CancelFields): PendingCancel {
  if (sub.status === "canceled" || sub.status === "incomplete_expired") return { pending: false, endsAt: null }
  if (sub.cancel_at) return { pending: true, endsAt: iso(sub.cancel_at) }
  if (sub.cancel_at_period_end) {
    const ends = (sub.items?.data ?? []).map((i) => i.current_period_end).filter((n): n is number => typeof n === "number")
    return { pending: true, endsAt: ends.length > 0 ? iso(Math.max(...ends)) : null }
  }
  return { pending: false, endsAt: null }
}

/**
 * The update that stops a pending cancellation, or null when none is pending.
 * Classic mode clears cancel_at_period_end; a cancel date is cleared with ""
 * (Stripe's way to unset a field), which covers flexible mode and custom dates.
 */
export function resumeParams(sub: CancelFields): Stripe.SubscriptionUpdateParams | null {
  if (!pendingCancelFrom(sub).pending) return null
  return sub.cancel_at_period_end ? { cancel_at_period_end: false } : { cancel_at: "" }
}

let ensured: Promise<void> | null = null

/** subscriptions.cancel_at: when a pending cancellation takes effect (null = none). */
export function ensureSubscriptionCancelAtColumn(): Promise<void> {
  if (!ensured) {
    ensured = (async () => {
      await ddl`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMPTZ`
    })().catch((err) => {
      ensured = null
      throw err
    })
  }
  return ensured
}
