import { NextRequest, NextResponse } from "next/server"
import { handleInboundSms } from "@/lib/sms-inbound"
import { twiml, validTwilioSignature } from "@/lib/twilio-webhook"

// Twilio "A message comes in" webhook for the Togethr number:
// https://mytogethr.com/api/webhooks/twilio-sms (HTTP POST).
// STOP / START / HELP are handled in lib/sms-inbound.ts (shared with Telnyx);
// the reply goes back as TwiML. Twilio also confirms STOP itself.

const xml = (body: string, status = 200) =>
  new NextResponse(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } })

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) return NextResponse.json({ error: "SMS not configured" }, { status: 503 })

  const params: Record<string, string> = {}
  for (const [k, v] of new URLSearchParams(await request.text())) params[k] = v

  // The signature covers the public URL Twilio called; behind the proxy
  // request.url may name the internal host, so try the forwarded one too.
  const url = new URL(request.url)
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host")
  const urls = [request.url]
  if (host) urls.push(`https://${host}${url.pathname}${url.search}`)
  if (!validTwilioSignature(authToken, request.headers.get("x-twilio-signature"), urls, params)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 })
  }

  try {
    const { reply } = await handleInboundSms(params.From, params.Body, "Twilio")
    return xml(twiml(reply ?? undefined))
  } catch (e) {
    // Twilio has already opted the number out at the carrier, so nothing
    // is sent either way; a 500 lets Twilio retry the webhook.
    console.error("[SMS] STOP sync failed:", e)
    return xml(twiml(), 500)
  }
}
