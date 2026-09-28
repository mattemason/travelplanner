import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { TripPlanner } from "@/components/planner/trip-planner";
import { currentUser } from "@/lib/auth";
import { getLabels } from "@/lib/labels";
import { loadTrip } from "@/lib/trip/load";

export const metadata: Metadata = { title: "Trip Planner" };

export default async function TripPage({ params }: PageProps<"/trips/[tripId]">) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { tripId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) notFound();
  const [trip, labels] = await Promise.all([loadTrip(user.id, tripId), getLabels(user.id)]);
  if (!trip) notFound();
  return <TripPlanner initial={trip} labels={labels} />;
}
