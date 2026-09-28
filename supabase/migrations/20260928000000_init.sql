-- Trip Planner initial schema. See SPEC.md "Data model".
-- Deviations from the spec table, all additive:
--   * stops.order is named stops.position ("order" is a reserved word).
--   * place_list_items joins places to lists (a place can sit in several Google lists);
--     places.source_list is kept as the list name it first came from.
--   * route_segments caches Routes API results; server-only (no RLS policies).
--   * place_lists.source also allows 'manual' for seeded and hand-entered lists.
--   * fixed_events stores date + optional local time, because most times are not yet known.

create extension if not exists pgcrypto;

-- users ---------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  email text,
  home_region text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, email, name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- trips ---------------------------------------------------------------------
create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  start_point text,
  end_point text,
  max_drive_hours_per_day numeric(4, 2) not null default 5,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.legs (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  name text not null,
  start_date date not null,
  end_date date not null,
  travellers text[] not null default '{}',
  colour text not null
);

create table public.fixed_events (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  type text not null,
  date date not null,
  time time,
  location text,
  notes text
);

-- places and lists ------------------------------------------------------------
create table public.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  google_place_id text,
  name text not null,
  lat double precision,
  lng double precision,
  address text,
  business_status text,
  photo_ref text,
  hours_json jsonb,
  source_list text,
  maps_url text,
  notes text,
  last_enriched_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index places_user_google_place on public.places (user_id, google_place_id)
  where google_place_id is not null;

create table public.place_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  source text not null check (source in ('takeout', 'share_link', 'csv', 'manual')),
  last_synced_at timestamptz,
  trip_id uuid references public.trips (id) on delete set null
);

create table public.place_list_items (
  list_id uuid not null references public.place_lists (id) on delete cascade,
  place_id uuid not null references public.places (id) on delete cascade,
  primary key (list_id, place_id)
);

-- days and stops ----------------------------------------------------------------
create table public.days (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  date date not null,
  leg_id uuid references public.legs (id) on delete set null,
  overnight_place_id uuid references public.places (id) on delete set null,
  notes text,
  unique (trip_id, date)
);

create table public.stops (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.days (id) on delete cascade,
  place_id uuid not null references public.places (id) on delete restrict,
  position integer not null,
  planned_time time,
  duration_mins integer,
  tags text[] not null default '{}'
    check (tags <@ array['4wd', 'walk', 'camp', 'permit', 'book_ahead', 'weather']),
  notes text,
  status text not null default 'planned' check (status in ('planned', 'done', 'skipped'))
);
create index stops_day_position on public.stops (day_id, position);

-- checklist, sync, AI, shares -----------------------------------------------------
create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  title text not null,
  category text,
  due_date date,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  url text,
  notes text,
  position integer not null default 0
);

create table public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  source text not null,
  started_at timestamptz not null default now(),
  diff_json jsonb,
  applied boolean not null default false
);

create table public.plan_proposals (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  created_at timestamptz not null default now(),
  prompt_json jsonb not null,
  proposal_json jsonb,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'rejected'))
);

-- Share tokens are resolved server-side with the service role (Phase 4),
-- so the family link never needs a login or a public RLS policy.
create table public.shares (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips (id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(18), 'base64'),
  leg_filter uuid references public.legs (id) on delete set null,
  expires_at timestamptz
);

create table public.route_segments (
  origin text not null,       -- "lat,lng" rounded to 5 dp
  destination text not null,
  duration_s integer not null,
  distance_m integer not null,
  fetched_at timestamptz not null default now(),
  primary key (origin, destination)
);

-- Row-level security ----------------------------------------------------------------
create function public.owns_trip(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from trips where id = t and owner_id = auth.uid());
$$;

create function public.owns_day(d uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from days join trips on trips.id = days.trip_id
    where days.id = d and trips.owner_id = auth.uid()
  );
$$;

alter table public.users enable row level security;
alter table public.trips enable row level security;
alter table public.legs enable row level security;
alter table public.fixed_events enable row level security;
alter table public.places enable row level security;
alter table public.place_lists enable row level security;
alter table public.place_list_items enable row level security;
alter table public.days enable row level security;
alter table public.stops enable row level security;
alter table public.checklist_items enable row level security;
alter table public.sync_runs enable row level security;
alter table public.plan_proposals enable row level security;
alter table public.shares enable row level security;
alter table public.route_segments enable row level security;

create policy "own profile" on public.users for all
  using (id = auth.uid()) with check (id = auth.uid());
create policy "own trips" on public.trips for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "own places" on public.places for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own lists" on public.place_lists for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own sync runs" on public.sync_runs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own list items" on public.place_list_items for all
  using (exists (select 1 from place_lists l where l.id = list_id and l.user_id = auth.uid()))
  with check (exists (select 1 from place_lists l where l.id = list_id and l.user_id = auth.uid()));

create policy "own legs" on public.legs for all
  using (owns_trip(trip_id)) with check (owns_trip(trip_id));
create policy "own fixed events" on public.fixed_events for all
  using (owns_trip(trip_id)) with check (owns_trip(trip_id));
create policy "own days" on public.days for all
  using (owns_trip(trip_id)) with check (owns_trip(trip_id));
create policy "own checklist" on public.checklist_items for all
  using (owns_trip(trip_id)) with check (owns_trip(trip_id));
create policy "own proposals" on public.plan_proposals for all
  using (owns_trip(trip_id)) with check (owns_trip(trip_id));
create policy "own shares" on public.shares for all
  using (owns_trip(trip_id)) with check (owns_trip(trip_id));
create policy "own stops" on public.stops for all
  using (owns_day(day_id)) with check (owns_day(day_id));
-- route_segments: no policies, so only the service role (server API routes) can touch it.
