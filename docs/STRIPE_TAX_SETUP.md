# Stripe Tax setup

Togethr can have Stripe calculate sales tax at checkout. **It is off until you turn it on.** The code only adds the tax fields when the environment variable `STRIPE_TAX_ENABLED` is exactly `true`.

**Whether tax applies to Togethr, where, and at what rate is a decision for you and your accountant.** Nothing in this guide or in the code settles any tax rule. These steps only cover the mechanics once you have decided.

## Before you turn it on

Do these in the Stripe Dashboard, in **test mode first**, then repeat in live mode.

1. **Business address.** Settings > Business > Business details: set the business's legal address. Stripe uses it as the origin address for tax.
2. **Tax registration.** Tax > Registrations: add the Massachusetts registration *only after confirming with your accountant* that you are registered and should collect, plus any other states they advise. **Automatic tax calculates nothing without a registration**: with the flag on and no registration, checkout silently charges no tax.
3. **Product tax codes.** Product catalog > each Togethr product (Basic / Premium): set the tax code your accountant chooses for the service (Stripe lists software / SaaS codes, such as "Software as a service (SaaS) - personal use"). Or set a default under Tax > Settings.
4. **Price tax behavior.** On every price (monthly and annual for each plan), set **Tax behavior** to *exclusive* (tax added on top of the price) or *inclusive* (tax included in the price), whichever you choose. The code deliberately does not set this. A price with no tax behavior can't be used with automatic tax.
5. **Test it.** In test mode, run a checkout with a Massachusetts billing address and check that the session shows the tax you expect.

## Turning it on

6. In Vercel > Project > Settings > Environment Variables, add `STRIPE_TAX_ENABLED` = `true` for **Production** (and Preview if you want to test there with test keys). Redeploy.

## What changes when it's on

- New checkouts collect a billing address (required), save it and the name to the existing Stripe customer, and calculate tax automatically. Tax ID collection stays off.
- A plan switch for an existing subscriber also turns on automatic tax for that subscription.
- Payment methods are still chosen by Stripe from your Dashboard settings (the code never sets `payment_method_types`).

To turn it off, delete the variable or set it to anything other than `true`, then redeploy. Checkout goes back to exactly what it was before.
