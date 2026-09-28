import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { loadTrip } from "@/lib/trip/load";
import { ChecklistView } from "./checklist-view";

export default async function ChecklistPage({ params }: PageProps<"/trips/[tripId]/checklist">) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { tripId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) notFound();
  const trip = await loadTrip(user.id, tripId);
  if (!trip) notFound();

  return (
    <main className="mx-auto w-full max-w-[640px] flex-1 bg-paper px-[18px] pt-[calc(10px+env(safe-area-inset-top))] pb-16 sm:my-6 sm:rounded-2xl">
      <Link href={`/trips/${trip.id}`} className="text-[14px] text-ocean">
        ‹ {trip.name}
      </Link>
      <h1 className="mt-0.5 text-[32px] font-bold">Checklist</h1>
      <p className="text-[14px] text-muted">Bookings, passes and gear for the trip.</p>
      <ChecklistView tripId={trip.id} items={trip.checklist} />
    </main>
  );
}
