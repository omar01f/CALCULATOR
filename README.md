# CalcPro

A pay-to-calculate SaaS demo. Calculations cost **$300 each** (credit) or **$99/month** (Monthly Pro, unlimited).

## Technologies
Node.js 18+ (built-in `http`, `crypto`, `fs` only — **zero npm dependencies**), vanilla JS single-page frontend, JSON-file storage (`data/db.json`).
Passwords are hashed with scrypt; sessions use HttpOnly cookies. Calculations are evaluated server-side by a safe parser (no `eval`).

## Install & run
```bash
cp .env.example .env      # optional; defaults work
npm start                 # no npm install needed
```
Open http://localhost:3000, sign up, then buy a credit or subscribe (demo checkout is free) and calculate.

## Environment variables
| Name | Purpose |
|---|---|
| `PORT` | Server port (default 3000) |
| `PAYMENT_PROVIDER` | `mock` (default, no keys) or `stripe` |
| `STRIPE_SECRET_KEY` | Stripe secret key (backend only, never sent to the browser) |
| `STRIPE_WEBHOOK_SECRET` | Verifies Stripe webhooks |

## Structure
- `server.js` – HTTP server, auth, calculator API, credits/subscription logic
- `payments.js` – **all payment logic** (provider interface). Frontend never touches card data or keys.
- `public/index.html` – UI (landing, pricing, auth, calculator, dashboard, checkout, settings)

## Connecting Stripe
1. Put `STRIPE_SECRET_KEY` in `.env` and set `PAYMENT_PROVIDER=stripe`.
2. In `payments.js`, implement the `stripe` provider: create a Checkout Session (`POST https://api.stripe.com/v1/checkout/sessions`; `mode=payment` for $300, `mode=subscription` with a $99 recurring price for Pro) and return its URL to the frontend, which redirects the user.
3. Add a `/api/webhook` route in `server.js` that verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`, then grants the credit (`user.credits++`) or sets `user.sub.end` on `checkout.session.completed` / `invoice.paid`.
4. Never grant access from the browser redirect alone; use the webhook.

Production notes: switch JSON storage to a real database, serve over HTTPS and add `Secure` to the cookie.
