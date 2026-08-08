# Decisions log

Decisions made autonomously while the user was AFK. Newest last.

## 2026-08-08 — Session 1 (M1 onwards)

1. **Repo/branch**: Directory wasn't a git repo. Ran `git init -b main` and I'm working
   directly on `main` — greenfield project, nothing to isolate from. Plan file moved to
   `docs/tipped-mvp-plan.md` so `create-next-app` could scaffold the root.
2. **Database**: Created a new Neon project `tipped` (project id `solitary-glitter-84104929`,
   region aws-us-west-2 — Neon MCP's create tool doesn't accept a region; if you want
   ap-southeast-2 like power-outage-monitor, we'd need to recreate via console). Connection
   string is in `.env.local` (not committed).
3. **Stripe/Resend keys**: I can't create accounts, so `.env.local` has placeholders.
   All Stripe/Resend code is written for real test mode, but automated tests mock the
   Stripe/Resend clients behind thin wrappers. Acceptance criteria that say "against
   Stripe test mode" are verified with mocked-transport integration tests; a manual
   test-mode run needs your keys — see README "Running against real Stripe".
4. **Auth**: Plan says "email magic links" but specifies no library. Implemented
   lightweight custom auth: HMAC-signed (jose) magic-link tokens (15 min expiry) and a
   signed session cookie (30 days). No sessions table — stateless. `AUTH_SECRET` added to
   env vars beyond the plan's list. Without `RESEND_API_KEY`, magic links are logged to
   the server console (dev fallback) so local login works.
5. **Parallelism**: Pure logic modules (composition, rotation/roundState) are developed
   by subagents in parallel with the M1 scaffold since they're pure functions with tests
   and no integration dependencies. Milestone *integration* still proceeds in order
   M1→M5 and each milestone's acceptance criteria are run before the next is wired up.
6. **shadcn/ui**: Initialised with defaults (new-york style, neutral base). Components
   added only as needed.
