import { createPublicKey, verify, type KeyObject } from "node:crypto"

// Telnyx webhooks (app/api/webhooks/telnyx-sms) are signed with Ed25519:
// telnyx-signature-ed25519 is the base64 signature of
// `${telnyx-timestamp}|${raw body}`, checked against the account's public
// key (Mission Control > Keys & Credentials > Public Key, base64).

/** Older (or further in the future) than this and the webhook is refused. */
export const TELNYX_MAX_AGE_SECONDS = 300

// DER prefix that wraps a raw 32-byte Ed25519 public key as SPKI.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function publicKeyFrom(base64: string): KeyObject | null {
  try {
    const raw = Buffer.from(base64.trim(), "base64")
    if (raw.length !== 32) return null
    return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, raw]), format: "der", type: "spki" })
  } catch {
    return null
  }
}

export function verifyTelnyxSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
  publicKeyBase64: string,
  nowSeconds: number = Date.now() / 1000
): boolean {
  if (!signature || !timestamp || !/^\d+$/.test(timestamp)) return false
  if (Math.abs(nowSeconds - Number(timestamp)) > TELNYX_MAX_AGE_SECONDS) return false
  const key = publicKeyFrom(publicKeyBase64)
  if (!key) return false
  const sig = Buffer.from(signature, "base64")
  if (sig.length !== 64) return false
  try {
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`, "utf8"), key, sig)
  } catch {
    return false
  }
}
