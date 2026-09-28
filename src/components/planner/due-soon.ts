import { daysUntil, shortDate } from "@/lib/trip/format";
import type { ChecklistItem } from "@/lib/trip/types";

export const DUE_SOON_DAYS = 14;

/** Open items due within 14 days (or overdue), then undated bookings, most urgent first. */
export function dueSoon(items: ChecklistItem[], today = new Date()) {
  return items
    .filter((c) => c.status !== "done")
    .map((c) => ({ item: c, days: c.dueDate ? daysUntil(c.dueDate, today) : null }))
    .filter((x) => x.days === null || x.days <= DUE_SOON_DAYS)
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
}

export function dueLabel(days: number | null, dueDate: string | null): string {
  if (days === null || !dueDate) return "No date";
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  return shortDate(dueDate);
}
