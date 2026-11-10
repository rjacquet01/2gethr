import { NextResponse } from 'next/server'

// DEPRECATED: this endpoint used to accept raw card number/CVV from the
// client, base64-"encode" it, and store it for manual admin processing.
// That was never PCI compliant (base64 is not encryption) and real card
// data should never reach our server at all.
//
// The upgrade page now calls POST /api/subscription/checkout instead,
// which creates a Stripe Checkout Session — card data goes straight from
// the browser to Stripe. This route is kept only so any stale cached
// client (an old service worker, an old mobile build) gets a clear error
// instead of silently submitting card data into our database.
export async function POST() {
  return NextResponse.json(
    {
      error:
        'This endpoint has been retired. Please refresh the app and use the updated upgrade flow.',
    },
    { status: 410 }
  )
}

// GET used to list a family's PENDING payment_transactions with every column
// (SELECT pt.*), for admin-processed upgrades from before Stripe. Nothing calls
// it any more, and those rows are not something to hand back in full: retired
// like POST.
export async function GET() {
  return NextResponse.json(
    { error: 'This endpoint has been retired. Please refresh the app.' },
    { status: 410 }
  )
}
