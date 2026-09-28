import { redirect } from "next/navigation";

// Checklists moved to /checklists; this keeps old links working.
export default async function OldChecklistPage({ params }: PageProps<"/trips/[tripId]/checklist">) {
  const { tripId } = await params;
  redirect(`/checklists?trip=${encodeURIComponent(tripId)}`);
}
