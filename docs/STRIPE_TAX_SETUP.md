# Stripe Tax setup

Togethr can have Stripe calculate sales tax at checkout. **It is off until you turn it on.** The code only adds the tax fields when the environment variable `STRIPE_TAX_ENABLED` is exactly `true`.

**Whether tax applies to Togethr, where, and at what rate is a decision for you and your accountant.** Nothing in this guide or in the code settles any tax rule. These steps only cover the mechanics once you have decided.

## Before you turn it on

Do these in the Stripe Dashboard, in **test mode first**, then repeat in live mode.

1. **Business address.** Settings > Business > Business details: set the business's legal address. Stripe uses it as the origin address for tax.
2. **Tax registration.** Tax > Registrations: add the Massachusetts registration *only after confirming with your accountant* that you are registered and should collect, plus any other states they advise. **Automatic tax calculates nothing without a registration**: with the flag on and no registration, checkout silently charges no tax.
3. **Product tax codes.** Product catalog > each Togethr product (Basic / Premium): set the tax code your accountant chooses for the service (Stripe lists software / SaaS codes, such as "Software as a service (SaaS) - personal use"). Or set a default under Tax > Settings.
4. **Price tax behavior: inclusive.** Togethr's prices are tax-inclusive: the advertised amount ($5.99, $9.99 and so on) is what the customer pays, and any tax comes out of it. The app shows "Price includes applicable sales tax" under paid prices. The code deliberately never sets `tax_behavior`; it is set in the Dashboard only. A price with no tax behavior can't be used with automatic tax. See **Making the prices tax-inclusive** below.
5. **Test it.** In test mode, run a checkout with a Massachusetts billing address and check that the session shows the tax you expect.

## Making the prices tax-inclusive

The app reads four price IDs from environment variables (`getPriceId` and `getTierFromPriceId` in `lib/stripe.ts`). The names don't match the plan names, so check carefully:

| Env var | Plan in the app | Billing |
|---|---|---|
| `STRIPE_PRICE_BASIC_MONTHLY` | Plus (`PREMIUM`, $5.99) | monthly |
| `STRIPE_PRICE_BASIC_ANNUAL` | Plus (`PREMIUM`, $59.90) | annual |
| `STRIPE_PRICE_PREMIUM_MONTHLY` | Premium (`PREMIUM_PLUS`, $9.99) | monthly |
| `STRIPE_PRICE_PREMIUM_ANNUAL` | Premium (`PREMIUM_PLUS`, $99.90) | annual |

For each of the four prices, in test mode and then live mode:

1. **Check its tax behavior.** Product catalog > the product > the price: look at **Tax behavior**.
   - *Unspecified:* edit the price and set it to **Inclusive**. Stripe allows this once, while it is unspecified.
   - *Inclusive:* nothing to do.
   - *Exclusive:* it can't be changed, so create a new price on the same product with the **same amount**, the same interval, and Tax behavior **Inclusive**.
2. **If you created new prices,** copy each new price ID (`price_...`) into the matching env var above in Vercel (Production, plus Preview with the test-mode IDs) and redeploy. Then archive the old exclusive prices in Stripe so nobody new is put on them.
3. **Existing subscribers** stay on the price they signed up with until their plan changes. If you want them on the inclusive price too, that's a separate change in Stripe (for example, switching each subscription's price with no proration). Decide that with your accountant.

Keep the dollar amounts the same. The app's displayed prices come from `lib/subscription-tiers.ts`, and changing an amount in Stripe without changing it there would make the app and checkout disagree.

### What inclusive pricing does to revenue (example)

With inclusive pricing the customer pays the same, and the tax comes out of your share. For illustration only, **if** your accountant confirms that Massachusetts's 6.25% sales tax applies:

- Plus monthly: $5.99 paid → $5.99 − $5.99 ÷ 1.0625 ≈ **$0.35 tax**, about **$5.64** to you before Stripe's fees.
- Premium monthly: $9.99 paid → about **$0.59 tax**, about **$9.40** to you before fees.

Customers outside your registered states pay no tax, and you keep the full amount (before fees).

## Turning it on

6. In Vercel > Project > Settings > Environment Variables, add `STRIPE_TAX_ENABLED` = `true` for **Production** (and Preview if you want to test there with test keys). Redeploy.

## What changes when it's on

- New checkouts collect a billing address (required), save it and the name to the existing Stripe customer, and calculate tax automatically. Tax ID collection stays off.
- A plan switch for an existing subscriber also turns on automatic tax for that subscription.
- Payment methods are still chosen by Stripe from your Dashboard settings (the code never sets `payment_method_types`).

To turn it off, delete the variable or set it to anything other than `true`, then redeploy. Checkout goes back to exactly what it was before.
