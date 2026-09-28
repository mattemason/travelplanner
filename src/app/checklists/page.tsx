import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { listChecklists } from "@/lib/checklists";
import { listTrips } from "@/lib/trip/load";
import { ChecklistsBrowser } from "./checklists-browser";

export const metadata: Metadata = { title: "Checklists · Trip Planner" };

export default async function ChecklistsPage({ searchParams }: PageProps<"/checklists">) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const [lists, trips, params] = await Promise.all([listChecklists(user.id), listTrips(user.id), searchParams]);
  const pick = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

  return (
    <ChecklistsBrowser
      lists={lists}
      trips={trips.map((t) => ({ id: t.id, name: t.name }))}
      initialTrip={pick(params.trip) ?? "all"}
      initialTag={pick(params.tag) ?? null}
    />
  );
}
