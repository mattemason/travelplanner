import { asc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { legs, trips } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

const formatDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

export default async function TripsPage() {
  const user = await currentUser();
  if (!user) redirect("/signin");

  const db = getDb();
  const myTrips = await db.select().from(trips).where(eq(trips.ownerId, user.id)).orderBy(asc(trips.startDate));
  const myLegs = myTrips.length
    ? await db
        .select()
        .from(legs)
        .where(inArray(legs.tripId, myTrips.map((t) => t.id)))
        .orderBy(asc(legs.startDate))
    : [];

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-[34px] font-bold">Trips</h1>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="hidden sm:inline">{user.email}</span>
          <SignOutButton />
        </div>
      </header>

      <div className="flex flex-wrap gap-2">
        <Link href="/trips/new" className="btn btn-primary">
          Add a new trip
        </Link>
        <Link href="/checklists" className="btn">
          Checklists
        </Link>
        <Link href="/profile" className="btn">
          Profile
        </Link>
      </div>

      {myTrips.length === 0 ? (
        <p className="text-muted">No trips yet. Add one to get started.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {myTrips.map((trip) => (
            <li key={trip.id} className="relative rounded-xl border border-line bg-paper p-4 hover:border-muted">
              <h2 className="text-[26px] font-bold">
                <Link href={`/trips/${trip.id}`} className="after:absolute after:inset-0">
                  {trip.name}
                </Link>
              </h2>
              <p className="text-muted">
                {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {myLegs
                  .filter((l) => l.tripId === trip.id)
                  .map((leg) => (
                    <span
                      key={leg.id}
                      className="rounded-full px-3 py-1 text-sm font-medium text-white"
                      style={{ backgroundColor: leg.colour }}
                    >
                      {leg.name}
                    </span>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
