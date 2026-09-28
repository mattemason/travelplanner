import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getChecklist, listChecklists } from "@/lib/checklists";
import { listTrips } from "@/lib/trip/load";
import { ChecklistEditor } from "./checklist-editor";

export default async function ChecklistPage({ params }: PageProps<"/checklists/[checklistId]">) {
  const user = await currentUser();
  if (!user) redirect("/signin");
  const { checklistId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(checklistId)) notFound();
  const [list, trips, all] = await Promise.all([
    getChecklist(user.id, checklistId),
    listTrips(user.id),
    listChecklists(user.id),
  ]);
  if (!list) notFound();
  const tagSuggestions = [...new Set(all.flatMap((l) => l.tags))].sort((a, b) => a.localeCompare(b));
  return <ChecklistEditor list={list} trips={trips.map((t) => ({ id: t.id, name: t.name }))} tagSuggestions={tagSuggestions} />;
}
