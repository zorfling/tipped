# Tipped
Self-organising speed dating. No organiser, no host — the app runs the show.

## Iron rules
- No code path may create a Stripe charge unless event.status === 'tipped';
  only chargeRegistration() in src/lib/payments.ts may create PaymentIntents.
- All money operations and emails are idempotent (idempotency keys / email_log).
- src/lib/composition.ts, src/lib/rotation.ts, and src/lib/roundState.ts are pure and
  fully unit-tested; never inline this logic in routes.
- Night-of state is derived from timestamps in the rounds table — never from
  a ticking process or a human action.
- Signup gating runs inside a transaction with a per-event lock.
- A profile photo is required to join an event; pairing depends on it.
- Non-mutual picks are never exposed to anyone. Blocked pairs are never
  scheduled together. Picks are purged 30 days post-event.
- Bucket labels are creator-defined strings. Never hardcode gender.
- The creator has no special powers after tip.

## Stack
Next.js App Router + TS strict, Drizzle + Neon, Stripe (test mode),
Resend, Netlify Blobs, Tailwind + shadcn, Vitest. Deploy: Netlify.

## Workflow
Work in milestones M1–M5 per docs/tipped-mvp-plan.md. Run `npm test` before
declaring a milestone done. Acceptance criteria live in the plan.
Decisions made without the user are logged in DECISIONS.md.
