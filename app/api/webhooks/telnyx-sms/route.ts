import { after, NextRequest, NextResponse } from "next/server"
import { handleInboundSms } from "@/lib/sms-inbound"
import { sendTelnyxReply } from "@/lib/services/sms"
import { verifyTelnyxSignature } from "@/lib/telnyx-webhook"

// Telnyx messaging webhook for the Togethr number:
// https://mytogethr.com/api/webhooks/telnyx-sms (HTTP POST).
// Signature first (lib/telnyx-webhook.ts), then message.received goes
// through the same STOP / START / HELP handling as Twilio
// (lib/sms-inbound.ts), except that HELP gets no reply from us: Telnyx's
// auto-response answers it. Replies go out through the Telnyx API after the
// 200, so Telnyx gets a quick answer.

/** Run after the response; outside a request (tests) just run it. */
async function afterResponse(task: () => Promise<unknown>) {
  try {
    after(task)
  } catch {
    await task()
  }
}

export async function POST(request: NextRequest) {
  const publicKey = process.env.TELNYX_PUBLIC_KEY
  if (!publicKey) return NextResponse.json({ error: "SMS not configured" }, { status: 503 })

  const raw = await request.text()
  if (
    !verifyTelnyxSignature(
      raw,
      request.headers.get("telnyx-signature-ed25519"),
      request.headers.get("telnyx-timestamp"),
      publicKey
    )
  ) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 })
  }

  let event: { data?: { event_type?: string; payload?: { from?: { phone_number?: string }; text?: string } } }
  try {
    event = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const data = event?.data
  if (data?.event_type !== "message.received") return NextResponse.json({ ok: true })

  const from = data.payload?.from?.phone_number
  try {
    const { keyword, reply } = await handleInboundSms(from, data.payload?.text, "Telnyx")
    // Telnyx's own auto-response answers HELP; a second reply would double it.
    if (reply && from && keyword !== "help") {
      await afterResponse(async () => {
        const r = await sendTelnyxReply(from, reply)
        if (!r.success) console.error("[SMS] Telnyx reply failed:", r.error)
      })
    }
  } catch (e) {
    // A STOP that wasn't saved: a 500 makes Telnyx retry the webhook.
    console.error("[SMS] STOP sync failed:", e)
    return NextResponse.json({ error: "Could not process" }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
