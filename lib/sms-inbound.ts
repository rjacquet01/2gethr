import { optOutNumber } from "./sms-consent"
import { SMS_HELP_REPLY } from "./sms-consent-text"

// Texts people send to the Togethr number, from either provider's webhook
// (app/api/webhooks/twilio-sms, app/api/webhooks/telnyx-sms). STOP and its
// synonyms turn texts off for that number's accounts; START leaves them off
// and says how to turn them on; HELP gets a short help reply. The provider
// confirms STOP itself, so STOP gets no reply from us.

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

/**
 * Acts on an inbound text and returns the reply to send, if any. Throws if
 * a STOP couldn't be saved, so the webhook can answer 500 and be retried.
 */
export async function handleInboundSms(
  from: string | null | undefined,
  body: string | null | undefined,
  provider: string
): Promise<{ keyword: SmsKeyword; reply: string | null }> {
  const keyword = smsKeyword(body)
  if (keyword === "help") return { keyword, reply: SMS_HELP_REPLY }
  if (keyword === "start") return { keyword, reply: SMS_START_REPLY }
  if (keyword === "stop" && from) {
    const n = await optOutNumber(from)
    console.log(`[SMS] STOP received (${provider}): texts turned off for ${n} account(s)`)
  }
  return { keyword, reply: null }
}
