@AGENTS.md

# Trip Planner

Mobile-first road trip planner. The product spec is `SPEC.md`: read it before starting work, and build one phase at a time.

## Commands

- `npm run dev`: dev server on http://localhost:3000
- `npm test`: Vitest unit tests (`tests/`)
- `npm run typecheck`, `npm run lint`
- `npm run seed`: loads `seed/tasmania-2027.json` into Supabase for `SEED_OWNER_EMAIL` (re-runnable, replaces that user's copy)
- Schema: apply `supabase/migrations/*.sql` with `supabase db push`, or paste into the Supabase SQL editor

## Setup

Copy `.env.local.example` to `.env.local` and fill it in. Never commit `.env.local`.

## Conventions

- Next.js 16 App Router, TypeScript, Tailwind 4. Check `node_modules/next/dist/docs/` before using Next APIs (see AGENTS.md).
- All Google (Routes, Places) and Anthropic calls go through server API routes. The only key in the browser is `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`, which is restricted to the Maps JavaScript API and our domains.
- Every table has RLS. Service-role access is limited to the seed script and server routes that need it (route cache, share links).
- `stops.position` is the stop order; the spec calls it `order`.
- Seed coordinates are approximate until Places enrichment (Phase 2) replaces them.
