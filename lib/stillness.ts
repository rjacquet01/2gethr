// Still/moving detection for live location sharing (web client). Pure and
// clock-free so it can be unit tested (scripts/test-stillness.ts).
//
// MOVING   - report at the normal pace (the user's interval, or faster when
//            the server asks because the phone is moving near a saved place).
// STILL_1  - still for STILL_1_AFTER_MS: report every STILL_1_INTERVAL_MS.
// STILL_2  - still for STILL_2_AFTER_MS: report every STILL_2_INTERVAL_MS.
// A fix that leaves the still radius, or a speed above MOVING_SPEED_MPS,
// goes straight back to MOVING and should be reported immediately.

/** Speed above this ends a still period at once (and triggers a report). */
export const MOVING_SPEED_MPS = 1
/** Speed at or above this means "not still" (no immediate report by itself). */
export const STILL_SPEED_MPS = 0.5
/** A fix within max(STILL_RADIUS_MIN_M, accuracy x factor) of the anchor is "in place". */
export const STILL_RADIUS_MIN_M = 30
export const STILL_RADIUS_ACCURACY_FACTOR = 1.5
/** Fixes needed in place before a still period can count. */
export const STILL_MIN_FIXES = 3
/** Still this long -> STILL_1. */
export const STILL_1_AFTER_MS = 3 * 60_000
export const STILL_1_INTERVAL_MS = 2 * 60_000
/** Still this long -> STILL_2. */
export const STILL_2_AFTER_MS = 10 * 60_000
export const STILL_2_INTERVAL_MS = 5 * 60_000
/** Longest a foregrounded app stays quiet because of stillness. */
export const MAX_QUIET_MS = STILL_2_INTERVAL_MS

export type MotionState = 'MOVING' | 'STILL_1' | 'STILL_2'

export interface MotionFix {
  /** ms since epoch */
  t: number
  lat: number
  lng: number
  /** reported accuracy in metres (null/undefined = unknown) */
  accuracy?: number | null
  /** reported speed in m/s (null/undefined = unknown) */
  speed?: number | null
}

export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3
  const p1 = (a.lat * Math.PI) / 180
  const p2 = (b.lat * Math.PI) / 180
  const dp = ((b.lat - a.lat) * Math.PI) / 180
  const dl = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** Radius around the anchor that still counts as "the same place" for this fix. */
export function stillRadius(fix: MotionFix, anchor: MotionFix): number {
  const acc = Math.max(fix.accuracy ?? 0, anchor.accuracy ?? 0)
  return Math.max(STILL_RADIUS_MIN_M, STILL_RADIUS_ACCURACY_FACTOR * acc)
}

export class StillnessTracker {
  private anchor: MotionFix | null = null
  private runStart = 0
  private runFixes = 0

  /**
   * Feed one fix. `leftStill` is true when this fix ended a STILL_1/STILL_2
   * period (left the radius or sped up): the caller should report it now.
   */
  update(fix: MotionFix): { state: MotionState; leftStill: boolean } {
    const before = this.state(fix.t)
    if (!this.anchor) {
      this.reset(fix)
      return { state: 'MOVING', leftStill: false }
    }
    const outside = metersBetween(this.anchor, fix) > stillRadius(fix, this.anchor)
    const fast = fix.speed != null && fix.speed > MOVING_SPEED_MPS
    if (outside || fast) {
      this.reset(fix)
      return { state: 'MOVING', leftStill: before !== 'MOVING' }
    }
    if (fix.speed != null && fix.speed >= STILL_SPEED_MPS) {
      // Drifting slowly in place: not still, but not a departure either.
      this.reset(fix)
      return { state: 'MOVING', leftStill: false }
    }
    this.runFixes++
    return { state: this.state(fix.t), leftStill: false }
  }

  state(now: number): MotionState {
    if (!this.anchor || this.runFixes < STILL_MIN_FIXES) return 'MOVING'
    const still = now - this.runStart
    if (still >= STILL_2_AFTER_MS) return 'STILL_2'
    if (still >= STILL_1_AFTER_MS) return 'STILL_1'
    return 'MOVING'
  }

  /** Report interval while still, or null while moving (use the normal pace). */
  stillIntervalMs(now: number): number | null {
    const s = this.state(now)
    return s === 'STILL_2' ? STILL_2_INTERVAL_MS : s === 'STILL_1' ? STILL_1_INTERVAL_MS : null
  }

  private reset(fix: MotionFix) {
    this.anchor = fix
    this.runStart = fix.t
    this.runFixes = 1
  }
}
