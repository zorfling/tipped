# Tipped

Self-organising speed dating. **No organiser, no host — the app runs the show.**

- **Composition-gated tickets**: each side of an event needs 6–12 people, roughly balanced, or the night doesn't happen.
- **Tip-or-refund**: your card is saved when you join, but only charged if the event *tips* at the deadline. Fizzled events charge nobody, ever.
- **App-run night**: check in on your phone; every round it shows the name + photo of the person you're meeting. No table numbers, no MC.
- **Morning-after reveal**: mutual yeses only. One-sided picks are never revealed to anyone, and picks are purged 30 days after the event.

## Stack

Next.js (App Router, TS strict) · Drizzle + Neon Postgres · Stripe (test mode) · Resend · Netlify (+ Blobs, Scheduled Functions) · Tailwind + shadcn/ui · Vitest.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values (see below)
npm run db:push              # push schema to your Neon database
npm run dev
```

`.env.local`:

| Var | Notes |
| --- | --- |
| `DATABASE_URL` | Neon Postgres connection string |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `STRIPE_WEBHOOK_SECRET` | Optional locally. **Without them the app runs in keyless dev mode**: the card step is skipped and charges are simulated. |
| `RESEND_API_KEY` | Optional locally — without it every email (including magic sign-in links) is printed to the server console. |
| `APP_URL` | e.g. `http://localhost:3000` |
| `CRON_SECRET` | Guards `/api/cron/tipper` |
| `AUTH_SECRET` | ≥32 random bytes; signs magic-link + session tokens |
| `ADMIN_EMAIL` | Receives safety reports |

The tipper cron runs every 10 minutes in production (Netlify scheduled function). Locally, poke it by hand:

```bash
curl -X POST "http://localhost:3000/api/cron/tipper?secret=$CRON_SECRET"
```

## Tests

```bash
npm test
```

Pure engines (`lib/composition`, `lib/rotation`, `lib/roundState`) have exhaustive unit + property tests. The `*.integration.test.ts` files run against the real `DATABASE_URL` (skipped when unset) and cover the plan's acceptance criteria end to end, including the concurrency race, exactly-once charging, and the simulated night with an injected clock.

## Running against real Stripe

Set the three Stripe vars to test-mode keys, then:

1. `stripe listen --forward-to localhost:3000/api/stripe/webhook` (gives you `STRIPE_WEBHOOK_SECRET`).
2. Join an event with card `4242 4242 4242 4242`, or `4000 0025 0000 3155` to exercise `authentication_required` and the fix-payment flow.
3. Use Stripe test clocks to fast-forward a customer past a deadline if you want the true off-session path.

## Out of scope (deliberately — see the plan)

Stripe Connect or payouts of any kind (the platform is the merchant; ticket revenue is platform revenue); native apps; trivia format; single-pool mode; algorithmic per-round matching (MVP is round-robin); geofenced check-in; refund automation (incl. night-of auto-cancel — charges stand); SMS; promo codes; photo moderation automation (**photos are unmoderated — known risk, manual for now**); i18n; admin panel beyond the report-inbox email.

Plan: `docs/tipped-mvp-plan.md` · Autonomous-session decisions: `DECISIONS.md`.
