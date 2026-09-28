"use client";

import { useRef, useState } from "react";
import { coverUrl } from "@/lib/trip/cover";


/** Shrinks a photo to at most 1600px wide as a JPEG, so uploads stay small. */
async function resize(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width, 1200 / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't read that image"))), "image/jpeg", 0.82),
  );
}

type Props = { tripId: string; version: number | null; onChange: (version: number | null) => void };

/** Cover photo for a trip: upload (resized first), replace or remove. Saves immediately. */
export function CoverPicker({ tripId, version, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = coverUrl(tripId, version);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", new File([await resize(file)], "cover.jpg", { type: "image/jpeg" }));
      const res = await fetch(`/api/trips/${tripId}/cover`, { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { version?: number; error?: string };
      if (!res.ok || !body.version) throw new Error(body.error ?? "Upload failed. Try again.");
      onChange(body.version);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/trips/${tripId}/cover`, { method: "DELETE" });
      if (!res.ok) throw new Error("Couldn't remove it. Try again.");
      onChange(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      Cover photo
      <div className="mt-1.5 flex items-center gap-3">
        <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-soft">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-gated image */}
          {url && <img src={url} alt="" className="h-full w-full object-cover" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn !min-h-9 !text-[13px]" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? "Saving…" : url ? "Change" : "Upload photo"}
          </button>
          {url && (
            <button type="button" className="cursor-pointer text-[13px] font-normal text-bad-ink underline" disabled={busy} onClick={remove}>
              Remove
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
      </div>
      {error && <p className="mt-1 text-[12.5px] font-normal text-bad-ink">{error}</p>}
    </div>
  );
}

export const TRIP_ICONS = ["🏕️", "🚙", "🏔️", "🌊", "🏖️", "🗺️", "🚐", "⛺", "🌲", "🦘", "✈️", "⛴️"];

/** Emoji for the trip card: pick one, type your own, or none. */
export function IconPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="field">
      Trip icon
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Trip icon">
        {TRIP_ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            aria-pressed={value === icon}
            onClick={() => onChange(value === icon ? null : icon)}
            className={`grid h-10 w-10 cursor-pointer place-items-center rounded-xl border-[1.5px] text-[20px] ${
              value === icon ? "border-ink bg-soft" : "border-line bg-paper"
            }`}
          >
            {icon}
          </button>
        ))}
        <input
          value={value && !TRIP_ICONS.includes(value) ? value : ""}
          onChange={(e) => onChange(e.target.value.trim() ? e.target.value.trim().slice(0, 16) : null)}
          placeholder="Other"
          aria-label="Your own emoji"
          className="!mt-0 !w-20 !px-2 !py-1.5 text-center"
        />
      </div>
    </div>
  );
}
