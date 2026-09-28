const parse = (iso: string) => new Date(`${iso}T00:00:00`);

/** "Mon 18 Jan" */
export const dayLabel = (iso: string) =>
  parse(iso).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");

/** "18 Jan" */
export const shortDate = (iso: string) => parse(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short" });

/** "18–20 Jan", or "26 Jan–3 Feb" across months */
export function dateRange(start: string, end: string): string {
  const a = parse(start);
  const b = parse(end);
  if (start === end) return shortDate(start);
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${shortDate(end)}`;
  return `${shortDate(start)}–${shortDate(end)}`;
}

/** "7:30am" from "07:30" */
export function timeLabel(hhmm: string | null): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}${h >= 12 ? "pm" : "am"}`;
}

export const dayCount = (start: string, end: string) =>
  Math.round((parse(end).getTime() - parse(start).getTime()) / 86_400_000) + 1;

/** Days from today until an ISO date (negative when past). */
export const daysUntil = (iso: string, today = new Date()) =>
  Math.round((parse(iso).getTime() - new Date(today.toDateString()).getTime()) / 86_400_000);
