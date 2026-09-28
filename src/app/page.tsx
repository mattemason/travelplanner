import { and, asc, count, eq, inArray, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import type { CSSProperties } from "react";
import { coverUrl } from "@/lib/trip/cover";
import { getDb } from "@/db";
import { legs, stops, trips } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { getProfile } from "@/lib/profile";
import { dateRange, dayCount, daysUntil } from "@/lib/trip/format";
import { SignOutButton } from "./sign-out-button";
import { DeleteTripButton } from "@/components/trips/delete-trip-button";
import { ThemeToggle } from "@/components/theme-toggle";

type TripCard = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  icon: string | null;
  coverVersion: number | null;
  legs: { id: string; name: string; startDate: string; endDate: string; colour: string }[];
  stops: number;
};

async function loadCards(userId: string): Promise<TripCard[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: trips.id,
      name: trips.name,
      startDate: trips.startDate,
      endDate: trips.endDate,
      icon: trips.icon,
      coverUpdatedAt: trips.coverUpdatedAt,
    })
    .from(trips)
    .where(eq(trips.ownerId, userId))
    .orderBy(asc(trips.startDate));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [legRows, stopCounts] = await Promise.all([
    db.select().from(legs).where(inArray(legs.tripId, ids)).orderBy(asc(legs.startDate)),
    db
      .select({ tripId: stops.tripId, n: count() })
      .from(stops)
      .where(and(inArray(stops.tripId, ids), isNotNull(stops.dayId)))
      .groupBy(stops.tripId),
  ]);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    startDate: r.startDate,
    endDate: r.endDate,
    icon: r.icon,
    coverVersion: r.coverUpdatedAt ? r.coverUpdatedAt.getTime() : null,
    legs: legRows.filter((l) => l.tripId === r.id),
    stops: stopCounts.find((s) => s.tripId === r.id)?.n ?? 0,
  }));
}

function whenLabel(t: TripCard): { text: string; tone: "soon" | "now" | "past" } {
  const toStart = daysUntil(t.startDate);
  const toEnd = daysUntil(t.endDate);
  if (toEnd < 0) return { text: "Finished", tone: "past" };
  if (toStart <= 0) return { text: `Day ${1 - toStart} of ${dayCount(t.startDate, t.endDate)}`, tone: "now" };
  if (toStart === 1) return { text: "Tomorrow", tone: "soon" };
  return { text: `In ${toStart} days`, tone: "soon" };
}

export default async function HomePage() {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const [cards, profile] = await Promise.all([loadCards(user.id), getProfile(user.id)]);
  const upcoming = cards.filter((c) => daysUntil(c.endDate) >= 0);
  const past = cards.filter((c) => daysUntil(c.endDate) < 0).reverse();
  const [next, ...later] = upcoming;
  const firstName = profile?.name.split(" ")[0];

  return (
    <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 pt-[calc(20px+env(safe-area-inset-top))] pb-20 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-display text-[15px] font-bold tracking-[0.12em] text-muted uppercase">Trip Planner</span>
        <nav className="flex items-center gap-1.5 text-[14px]" aria-label="Account">
          <Link href="/checklists" className="rounded-full px-3 py-2 font-bold text-ink hover:bg-paper">
            Checklists
          </Link>
          <Link href="/profile" className="rounded-full px-3 py-2 font-bold text-ink hover:bg-paper">
            Profile
          </Link>
          <ThemeToggle />
          <SignOutButton />
        </nav>
      </header>

      <section className="mt-6 mb-7">
        <h1 className="text-[44px] leading-none font-bold sm:text-[56px]">{firstName ? `G'day, ${firstName}` : "Your trips"}</h1>
        <p className="mt-2 text-[16px] text-muted">
          {next
            ? `${next.name} ${whenLabel(next).tone === "now" ? "is under way" : `starts ${whenLabel(next).text.toLowerCase()}`}.`
            : "Nothing planned yet. Where to next?"}
        </p>
      </section>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {next && <TripTile trip={next} featured />}
        {later.map((t) => (
          <TripTile key={t.id} trip={t} />
        ))}
        <Link
          href="/trips/new"
          className="grid min-h-[260px] place-items-center rounded-2xl border-2 border-dashed border-line bg-paper/40 p-6 text-center hover:border-muted hover:bg-paper"
        >
          <span>
            <span className="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-ink text-[26px] leading-none text-paper">
              +
            </span>
            <span className="block font-display text-[22px] font-bold">Plan a new trip</span>
            <span className="text-[14px] text-muted">Name it, set the dates, add stops</span>
          </span>
        </Link>
      </div>

      {past.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 text-[26px] font-bold">Past trips</h2>
          <div className="grid gap-5 opacity-80 sm:grid-cols-2 lg:grid-cols-3">
            {past.map((t) => (
              <TripTile key={t.id} trip={t} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function TripTile({ trip, featured }: { trip: TripCard; featured?: boolean }) {
  const when = whenLabel(trip);
  const days = dayCount(trip.startDate, trip.endDate);
  const url = coverUrl(trip.id, trip.coverVersion);
  const colours = trip.legs.length ? trip.legs.map((l) => l.colour) : ["#1F5A7A", "#2F6B4F"];

  return (
    <article
      className={`group relative overflow-hidden rounded-2xl border border-line bg-paper shadow-[0_1px_2px_rgba(10,20,22,0.06)] transition-shadow hover:shadow-[0_10px_30px_rgba(10,20,22,0.12)] ${
        featured ? "sm:col-span-2" : ""
      }`}
    >
      <div className={`relative ${featured ? "h-56 sm:h-72" : "h-40"} overflow-hidden`}>
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- private, auth-gated image
          <img
            src={url}
            alt=""
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <DefaultCover colours={colours} seed={trip.id} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/10 to-transparent" />
        <span
          className={`absolute top-3 right-3 rounded-full px-2.5 py-1 text-[12.5px] font-bold ${
            when.tone === "now" ? "bg-good-bg text-good-ink" : when.tone === "past" ? "bg-paper/90 text-muted" : "bg-paper/90 text-ink"
          }`}
        >
          {when.text}
        </span>
        <div className="absolute right-4 bottom-3 left-4 flex items-end gap-3 text-white">
          {trip.icon && (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/95 text-[26px] shadow">{trip.icon}</span>
          )}
          <div className="min-w-0">
            <h2 className={`${featured ? "text-[36px]" : "text-[26px]"} leading-none font-bold drop-shadow`}>
              <Link href={`/trips/${trip.id}`} className="after:absolute after:inset-0">
                {trip.name}
              </Link>
            </h2>
            <p className="mt-1 text-[14px] opacity-95 drop-shadow">
              {dateRange(trip.startDate, trip.endDate)} {trip.endDate.slice(0, 4)}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-3 pb-4">
        {trip.legs.length > 0 && (
          <>
            <div className="flex h-2 overflow-hidden rounded-full bg-soft" aria-hidden="true">
              {trip.legs.map((l) => (
                <i key={l.id} style={{ flexGrow: dayCount(l.startDate, l.endDate), background: l.colour }} />
              ))}
            </div>
            <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px] text-muted">
              {trip.legs.map((l) => (
                <li key={l.id} className="flex items-center gap-1.5">
                  <i className="inline-block h-2 w-2 rounded-full" style={{ background: l.colour }} />
                  {l.name} · {dateRange(l.startDate, l.endDate)}
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="mt-2.5 flex items-center gap-4 text-[13.5px]">
          <span>
            <b className="font-display text-[18px]">{days}</b> <span className="text-muted">days</span>
          </span>
          <span>
            <b className="font-display text-[18px]">{trip.stops}</b> <span className="text-muted">stops</span>
          </span>
          <span>
            <b className="font-display text-[18px]">{trip.legs.length}</b>{" "}
            <span className="text-muted">{trip.legs.length === 1 ? "leg" : "legs"}</span>
          </span>
          {/* Above the card's full-size link so it can be clicked. */}
          <DeleteTripButton tripId={trip.id} name={trip.name} className="relative z-10 ml-auto" />
        </div>
      </div>
    </article>
  );
}

/** A soft topographic pattern in the trip's leg colours, used until a photo is added. */
function DefaultCover({ colours, seed }: { colours: string[]; seed: string }) {
  const n = [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  const lines = Array.from({ length: 9 }, (_, i) => {
    const y = 20 + i * 26;
    const a = 18 + ((n + i * 7) % 22);
    return `M-20 ${y} C 90 ${y - a}, 180 ${y + a}, 290 ${y - a / 2} S 470 ${y + a}, 620 ${y}`;
  });
  const middle = colours[Math.floor(colours.length / 2)] ?? colours[0];
  const style = {
    background: `linear-gradient(135deg, ${colours[0]} 0%, ${middle} 55%, ${colours.at(-1)} 100%)`,
  } as CSSProperties;
  return (
    <div className="h-full w-full" style={style}>
      <svg viewBox="0 0 600 260" preserveAspectRatio="xMidYMid slice" className="h-full w-full opacity-35" aria-hidden="true">
        {lines.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="white" strokeWidth={1.3} />
        ))}
      </svg>
    </div>
  );
}
