@AGENTS.md

# Trip Planner

Mobile-first road trip planner. The product spec is `SPEC.md`: read it before starting work, and build one phase at a time.

## Commands

- `npm run dev`: dev server on http://localhost:3000
- `npm test`: Vitest unit tests (`tests/`)
- `npm run typecheck`, `npm run lint`
- `npm run seed`: loads `seed/tasmania-2027.json` for `SEED_OWNER_EMAIL` (re-runnable, replaces that user's copy)
- Schema lives in `src/db/schema.ts` (Drizzle). After changing it, run `npm run db:generate` and commit the new file in `drizzle/`. Railway applies pending migrations before each deploy (`npm run db:migrate`).
- Postgres has no public endpoint, so run DB scripts inside Railway: `railway ssh -- npm run seed`

## Setup

Copy `.env.local.example` to `.env.local` and fill it in. Never commit `.env.local`.

## Conventions

- Next.js 16 App Router, TypeScript, Tailwind 4. Check `node_modules/next/dist/docs/` before using Next APIs (see AGENTS.md).
- All Google (Routes, Places) and Anthropic calls go through server API routes. The only key in the browser is `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY`, which is restricted to the Maps JavaScript API and our domains.
- No RLS: only server code touches the database, and every query must filter by the signed-in user's id.
- `stops.position` is the stop order; the spec calls it `order`.
- Seed coordinates are approximate until Places enrichment (Phase 2) replaces them.

## Hosting

Railway (project `renewed-dedication`, service `travelplanner`) deploys every push to `main`: https://travelplanner-production-1644.up.railway.app. Build and start commands are in `railway.json`.

- Set env vars in the Railway service, not in the repo. `NEXT_PUBLIC_*` values are baked in at build time, so changing one needs a redeploy.
- The Google browser key's referrer restrictions must include the Railway domain and `localhost:3000`.
- `railway logs` / `railway status` from the repo root (it's linked).
