import { createHmac, timingSafeEqual } from "node:crypto"

// Inbound texts from Twilio (app/api/webhooks/twilio-sms). Twilio already
// handles STOP / START / HELP at the carrier level; this keeps our database
// in step and answers HELP and START.

/**
 * Twilio's request signature: base64 HMAC-SHA1, keyed with the auth token,
 * of the full URL followed by every POST parameter (sorted by name) as
 * name + value.
 */
export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("")
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64")
}

/** Whether `signature` matches for any of the URLs the request may have been sent to. */
export function validTwilioSignature(
  authToken: string,
  signature: string | null,
  urls: string[],
  params: Record<string, string>
): boolean {
  if (!signature) return false
  const got = Buffer.from(signature)
  return urls.some((url) => {
    const want = Buffer.from(twilioSignature(authToken, url, params))
    return want.length === got.length && timingSafeEqual(want, got)
  })
}

export type SmsKeyword = "stop" | "start" | "help" | null

const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "OPTOUT", "REVOKE"])
const START = new Set(["START", "UNSTOP", "YES"])
const HELP = new Set(["HELP", "INFO"])

/** The opt-out keyword a whole message is, if any ("Stop." counts, "stop by later" doesn't). */
export function smsKeyword(body: string | null | undefined): SmsKeyword {
  const word = (body || "").trim().replace(/[.!?]+$/, "").toUpperCase()
  if (STOP.has(word)) return "stop"
  if (START.has(word)) return "start"
  if (HELP.has(word)) return "help"
  return null
}

export const SMS_START_REPLY =
  "Togethr: You can receive texts again. To turn notification texts back on, go to Settings > Notifications at mytogethr.com."

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] as string)

/** TwiML that replies with `message`, or says nothing. */
export function twiml(message?: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${esc(message)}</Message>` : ""}</Response>`
}
