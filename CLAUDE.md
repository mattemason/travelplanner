@AGENTS.md

# Trip Planner

Mobile-first road trip planner. The product spec is `SPEC.md`: read it before starting work, and build one phase at a time.

## Commands

- `npm run dev`: dev server on http://localhost:3000
- `npm test`: Vitest unit tests (`tests/`)
- `npm run typecheck`, `npm run lint`
- `npm run seed`: loads `seed/tasmania-2027.json` for `SEED_OWNER_EMAIL`, replacing that user's copy. `npm start` runs it with `--if-missing`, which only seeds when the owner doesn't have the trip yet, so deploys never overwrite edits.
- Schema lives in `src/db/schema.ts` (Drizzle). After changing it, run `npm run db:generate` and commit the new file in `drizzle/`. `npm start` applies pending migrations first.
- Postgres has no public endpoint; anything that must touch the production DB runs from `npm start` or a server route.
- `/api/health` reports DB reachability and the applied migration count.

## Auth and email

- Sign-in is an emailed link (next-auth v4 email provider, JWT sessions, 60 days). Only `ALLOWED_EMAILS` are sent a link. `src/lib/auth.ts` has a minimal Drizzle adapter; use `currentUser()` in server code.
- Email goes through Postmark's HTTP API (`src/lib/email.ts`), from `EMAIL_FROM` on the verified socialtap.com.au domain.

## Setup

Copy `.env.local.example` to `.env.local` and fill it in. Never commit `.env.local`.

## Conventions

- Next.js 16 App Router, TypeScript, Tailwind 4. Check `node_modules/next/dist/docs/` before using Next APIs (see AGENTS.md).
- All Google (Routes, Places) and Anthropic calls go through server API routes. The only key in the browser is `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`, which is restricted to the Maps JavaScript API and our domains.
- No RLS: only server code touches the database, and every query must filter by the signed-in user's id.
- `stops.position` is the stop order; the spec calls it `order`.
- Seed coordinates are approximate until Places enrichment (Phase 2) replaces them.

## Hosting

Railway (project `renewed-dedication`, service `travelplanner`) deploys every push to `main`: https://travel.emason.com.au (also https://travelplanner-production-1644.up.railway.app). Railpack runs `npm run build` then `npm start`; `npm start` applies pending migrations before starting Next.js.

- Set env vars in the Railway service, not in the repo. `NEXT_PUBLIC_*` values are baked in at build time, so changing one needs a redeploy.
- The Google browser key is restricted to travel.emason.com.au, the Railway domain and `localhost:3000`. The server key (Routes, Places) has no application restriction.
- `railway logs` / `railway status` from the repo root (it's linked).
