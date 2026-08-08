# Tipped — MVP Implementation Plan (v0.1 + v0.2)

Working title: **Tipped** (rename freely).

This document is written to be handed to Claude Code. Work milestone by milestone (M1–M5). Do not start a milestone until the previous one's acceptance criteria pass.

---

## 0. Product thesis (context, keep in mind while building)

Self-organising speed dating. **There is no organiser and no host — the app runs the show.** Any user can create an event; the creator is just the first attendee and has no special powers on the night. The platform is the merchant.

Core mechanics:

1. **Composition-gated tickets.** The attendance threshold is a shape, not a number: ~N per side, roughly balanced, or it doesn't happen.
2. **Tip-or-refund.** Card saved at signup; charged only if the event tips at the deadline. Nobody pays for a dud night.
3. **App-run night.** Rounds are timer-driven and server-controlled. Pairing is CitySwoon-style: no numbered tables — each round your phone shows the **name + photo** of the person you're meeting, and you find each other.
4. **Lightweight profiles.** Name + photo (photo required to join — pairing depends on it). No bios, no swiping. This is not a dating app; it's event infrastructure.

---

## 1. Stack & conventions

Opinionated defaults — swap only with good reason:

- **Next.js (App Router) + TypeScript (strict)**, deployed on **Netlify**
- **Postgres (Neon)** + **Drizzle ORM** (schema in code, `drizzle-kit` migrations)
- **Stripe** for payments (test mode throughout the MVP)
- **Resend** for transactional email
- **Netlify Blobs** for profile photos (client-side resize/crop to square ≤ 512px before upload)
- **Tailwind + shadcn/ui**, mobile-first — every guest surface is a phone screen at a bar
- **Netlify Scheduled Function** (every 10 min) for the tipper job; night-of state is computed from timestamps, not a ticking process (see §6)
- **Vitest**; the composition engine, rotation scheduler, and round state machine must be pure functions with tests
- Realtime = **polling** (10s pre-event, 5s during the event). No websockets in the MVP
- Auth: **email magic links for everyone** (no passwords). Users are lightweight accounts with a profile, since profiles persist across events

Environment variables in `.env.example`: `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, `RESEND_API_KEY`, `APP_URL`, `CRON_SECRET`.

---

## 2. Domain model

Enums:

- `event_status`: `draft | open | tipped | locked | live | matched | fizzled | cancelled`
- `registration_state`: `reserved | waitlisted | confirmed | released | refunded | cancelled | checked_in | no_show`
- `charge_status`: `pending | succeeded | requires_action | failed`

Tables (Drizzle):

- **users**: id, email (unique), name, photo_url (nullable until first join), stripe_customer_id, created_at
- **events**: id, creator_id → users, slug (unique, short), title, city, venue_name, venue_address, venue_notes (free text: "back bar, look for the neon flamingo"), starts_at (timestamptz), tip_deadline_at (default starts_at − 48h), max_imbalance (default 2), round_length_sec (default 300), break_length_sec (default 90), status, format (`'speed_dating'` only), created_at
- **buckets**: id, event_id, label (creator-defined text — do **not** hardcode gender; defaults "Side A"/"Side B"), min_size (default 6), max_size (default 12), price_cents, sort_order
- **registrations**: id, event_id, bucket_id, user_id, state, manage_token (unique), stripe_setup_intent_id, stripe_payment_method_id, created_at, waitlisted_at, checked_in_at (nullable), unique(event_id, user_id)
- **charges**: id, registration_id, stripe_payment_intent_id (unique), amount_cents, status — append-only; retries create rows
- **email_log**: id, event_id, registration_id (nullable), type, sent_at — for idempotent sends

v0.2 adds:

- **rounds**: id, event_id, number, scheduled_start_at, scheduled_end_at — all rounds are written at schedule generation; "current round" is derived from now() vs these timestamps
- **assignments**: id, round_id, registration_a_id, registration_b_id (nullable = bye)
- **picks**: id, event_id, from_registration_id, to_registration_id, choice (`yes | no`), unique(from, to)
- **matches**: id, event_id, registration_a_id, registration_b_id, revealed_at
- **blocks**: id, blocker_user_id, blocked_user_id, created_at — blocked pairs are never scheduled together in any future event
- **reports**: id, event_id, reporter_user_id, reported_user_id, body, created_at

---

## 3. The composition engine (core invariants)

Implement as a pure module `lib/composition.ts` with exhaustive unit tests. Counting rule: a bucket's **active count** = registrations in `reserved | confirmed | checked_in`.

1. **Gate on entry.** A signup lands as `reserved` only if (a) bucket active count < max_size AND (b) the resulting imbalance across buckets ≤ `max_imbalance`. Otherwise it lands as `waitlisted` (card still saved) — the UI must say so *before* payment details.
2. **Promotion.** On every state change (cancel, release, opposite-side signup), promote the oldest `waitlisted` registration whose promotion keeps constraints valid. Promotion sends the "you're in" email.
3. **Tip condition.** At `tip_deadline_at`: event tips iff every bucket's active count ≥ min_size AND imbalance ≤ max_imbalance. Else it **fizzles**.
4. **Money rule (sacred).** No charge is ever created unless the event is `tipped`. The only code path that creates PaymentIntents is the tipper job (plus its webhook retries). Enforce with a single `chargeRegistration()` that throws if `event.status !== 'tipped'`.
5. **Idempotency everywhere.** Charging uses idempotency key `tip-{registration_id}`; the tipper job is safe to run twice; emails check `email_log` first.
6. **Post-tip charge failures do not un-tip the event.** Mark the charge `failed`, email a fix-payment link (24h), exclude unresolved failures from the night-of schedule. Don't engineer further in the MVP.
7. **The creator is not special.** Creators can edit/cancel *before* tip and extend the deadline once; after tip they are just another attendee. No creator action is required for the event to run.

Concurrency: wrap signup + gate check in a transaction with `SELECT ... FOR UPDATE` on the event row (or an advisory lock per event) so two simultaneous signups can't both squeak past the imbalance gate.

---

## 4. Payments design (the part to get right)

**Do not use manual-capture authorisation holds** — they expire in ~7 days and events are created weeks out. Instead:

1. **At signup:** create/find Stripe Customer for the user → **SetupIntent** → confirm card with Stripe Elements → store `payment_method_id`. Consent copy on the button: *"Save card — you'll only be charged if the event goes ahead."* SCA during setup is on-session (easy).
2. **At tip:** create an **off-session PaymentIntent** per reserved registration (`off_session: true, confirm: true`, saved PM, idempotency key as above).
3. **Webhooks** (`/api/stripe/webhook`, signature-verified): `payment_intent.succeeded` → registration `confirmed` + receipt; `payment_intent.payment_failed` / `requires_action` → mark charge, send a fix-payment magic link that completes 3DS on-session.
4. **Fizzle path:** zero PaymentIntents ever created; registrations → `released`; send the "it fizzled — you were never charged" email.
5. The **platform is the merchant of record**: all charges land in the single platform Stripe account. There are no payouts to anyone — ticket price is a commitment device and platform revenue. Creator cannot set price below a floor constant (`MIN_PRICE_CENTS = 1000`) — free RSVPs flake and break the whole thesis.
6. Stripe **test clocks** + test cards (incl. `4000002500003155` for `authentication_required`) in the test plan.

---

## 5. v0.1 scope — composition-gated ticketing with tip-or-refund

### Routes

- `/` — landing + **public list of open events** (city text filter, soonest first). Self-organising needs discovery, but keep it a dumb list
- `/create` — signed-in users create an event from the speed-dating template (2 buckets, min 6 / max 12, imbalance 2, price, deadline 48h before start). Creating auto-registers the creator into a bucket of their choice (they're attendee #1)
- `/e/[slug]` — **public event page** (the heart of it): venue/time, countdown to tip deadline, live per-bucket tally ("5 of 6 needed on Side A"), progress bars, per-bucket CTA switching between *Join* / *Join waitlist (Side B is ahead)* / *Sold out*. Poll every 10s. Make the progress state feel alive — this page is the growth loop
- `/e/[slug]/join/[bucketId]` — sign in if needed → complete profile (name + **required photo**) → Stripe Elements (SetupIntent) → confirmation screen stating exactly what happens next
- `/me` — profile (edit name/photo) + my events; per-registration: status, cancel (frees slot → promotion), fix-payment link
- `/api/cron/tipper` — every 10 min (guarded by `CRON_SECRET`): `open` events past deadline → tip (and charge) or fizzle (and release)

### Emails (Resend, idempotent via email_log)

reserved ("you're in *if* it tips — charged only then"), waitlisted, promoted, tipped+charged (receipt + `.ics`), fizzled, charge-failed (fix link), day-before reminder with venue_notes.

### v0.1 acceptance criteria

- Balance gate: with imbalance at limit, the next same-side signup is waitlisted with correct pre-payment messaging
- Cancellation on the lagging side promotes the oldest eligible waitlisted person and emails them
- Tipper on a satisfied event: charges every reserved registration exactly once (rerun the job — zero duplicate PaymentIntents), one email each
- Tipper on an unsatisfied event: fizzles, creates **zero** PaymentIntents, releases everyone
- Failed off-session charge is recoverable via the fix-payment link
- Two concurrent signups for the last balanced slot: exactly one reserved, one waitlisted
- Creating an event registers the creator; a creator cancelling pre-tip releases everyone unchargeed

---

## 6. v0.2 scope — the app runs the night

No host exists. The night is a **pre-computed timeline plus a derived state machine** — nothing needs to "press start."

### Self check-in

Check-in opens `starts_at − 15 min` and closes `starts_at + 10 min` (grace). Guests tap **"I'm here"** on their event screen. No geofencing in the MVP — trust the button.

### Schedule generation (automatic)

A scheduled function at `starts_at + 10 min`: take checked-in registrations, generate the full schedule, write every `rounds` row with `scheduled_start_at` / `scheduled_end_at` (round_length + break cadence), set event `live`. From then on, **current round = pure function of now() and the rounds table** — clients poll `/e/[slug]/state` (5s) and render accordingly. No server ticker, no host button.

- Rotation: pure `lib/rotation.ts` — `scheduleRounds(sideA: Id[], sideB: Id[], blocks: Pair[]): Round[]`. Round-robin so everyone meets everyone on the opposite side; unequal sides (≤ max_imbalance) rotate byes evenly; **blocked pairs are never assigned** (swap within the round; a bye is acceptable if unavoidable)
- Property tests: every non-blocked A×B pair meets exactly once; nobody double-booked in a round; bye counts differ by ≤ 1
- Late arrivals after generation: check-in stays possible until round 2 ends; they fill bye seats only (never regenerate mid-event — document this rule)
- Too few checked in to run (< 3 per side): event auto-cancels night-of with an apology email. Charges stand in the MVP (document; refund automation is out of scope)

### The pairing screen (this replaces table numbers)

Guest view during a live event (`/e/[slug]/tonight`):

- **Round n banner + countdown**, then a full-screen card: the other person's **photo (large), first name**, and the shared prompt *"Find each other."* Both parties see the same card mirrored — that mutual photo lookup is the whole coordination mechanism
- Break state between rounds: "Next: **Sam** — starts in 1:12", so people can reposition
- Bye state: "Sit this one out — grab a drink. Back in round 4"
- After each round (and editable until close): **Yes / No** on the person just met (upsert into `picks`)

### Close + reveal

- Event auto-closes at final round end + 15 min → compute mutuals (yes in both directions) → write `matches` → status `matched`
- Reveal email goes out **the next morning at 9am local** (scheduled, not instant — let the night breathe): your mutual matches with first name, photo, and contact. **Non-mutual picks are never revealed to anyone, ever**
- **Privacy rule:** auto-purge `picks` 30 days post-event (keep `matches`). Dating data is sensitive; store the minimum. Ship the purge in v0.2, not "later"

### Safety baseline (non-negotiable given there's no host)

- **Report** button on every pairing card and in the reveal email → `reports` row + notification email to the admin address
- **Block** from the reveal email or `/me`: blocked pairs are excluded from all future scheduling
- Code-of-conduct checkbox at first join; repeated reports flag the user (manual review — no automation in MVP)

### v0.2 acceptance criteria

- Simulated 8v8 with all checked in: 8 rounds auto-generated, all 64 pairs met once, state endpoint returns correct round at arbitrary timestamps (test with injected clock)
- 8v6: byes spread evenly; a late check-in during round 1 fills a bye seat from round 2
- A block between A3 and B5 → they are never assigned; everything else still meets
- Mutual yes → match + morning reveal email; single-sided yes → nothing revealed to either party
- Purge job removes picks 30 days post-event; matches remain

---

## 7. Milestones (one Claude Code session each)

- **M1 — Skeleton:** scaffold, full Drizzle schema (incl. v0.2 tables), magic-link auth, profile with photo upload (Netlify Blobs, client-side square crop), event create-from-template with creator auto-registration, public event list + event page with live tally (no payments). *Done when an event is creatable and its public page renders real counts.*
- **M2 — Composition + signup:** composition module + tests, join flow with SetupIntent, waitlisting, cancellation + promotion. *Done when the balance-gate and promotion criteria pass.*
- **M3 — Money:** tipper cron, off-session charging, webhooks, all emails, fizzle path, creator pre-tip controls. *Done when all v0.1 acceptance criteria pass against Stripe test mode.*
- **M4 — Autonomous night:** self check-in, schedule generation function, rotation engine + property tests (incl. block exclusion), derived round state machine + `/state` endpoint, pairing screen with photo cards. *Done when a simulated 8v6 event runs end-to-end with an injected clock and no human intervention.*
- **M5 — Matching + safety:** match cards, auto-close, mutual computation, morning reveal, picks purge, report/block. *Done when all v0.2 criteria pass.*

---

## 8. Out of scope (do not build, note in README)

Stripe Connect or payouts of any kind; native apps; trivia format (the composition engine generalises — v0.3); single-pool mode (everyone meets everyone, one bucket — v0.3); algorithmic/preference-based matching per round (CitySwoon-style matching brains — v0.3; MVP is round-robin); geofenced check-in; refund automation; SMS; promo codes; photo moderation automation (manual for now — note the risk); i18n; admin panel beyond a report inbox email.

---

## 9. CLAUDE.md for the repo

```md
# Tipped
Self-organising speed dating. No organiser, no host — the app runs the show.

## Iron rules
- No code path may create a Stripe charge unless event.status === 'tipped';
  only chargeRegistration() in lib/payments.ts may create PaymentIntents.
- All money operations and emails are idempotent (idempotency keys / email_log).
- lib/composition.ts, lib/rotation.ts, and lib/roundState.ts are pure and
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
Work in milestones M1–M5 per tipped-mvp-plan.md. Run `npm test` before
declaring a milestone done. Acceptance criteria live in the plan.
```

---

## 10. First prompt to give Claude Code

> Read `tipped-mvp-plan.md` and `CLAUDE.md`. Set up the project per §1, then implement Milestone M1 only. Write the Drizzle schema for §2 in full (including v0.2 tables), but build UI/logic only as far as M1 requires. Show me the schema and the public event page before moving on.
