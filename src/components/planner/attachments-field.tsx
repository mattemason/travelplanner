"use client";

import { useRef, useState } from "react";
import type { Attachment } from "@/lib/trip/types";

const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const iconFor = (type: string) => (type === "application/pdf" ? "📄" : type.startsWith("image/") ? "🖼️" : "📎");

type Props = {
  stopId: string | null; // null for a stop that hasn't been saved yet
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
};

/** Files on a stop: add (uploads straight away), open, and delete (asks first). */
export function AttachmentsField({ stopId, attachments, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (files: FileList) => {
    if (!stopId || !files.length) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      [...files].forEach((f) => form.append("files", f));
      const res = await fetch(`/api/stops/${stopId}/attachments`, { method: "POST", body: form });
      const body = (await res.json().catch(() => ({}))) as { attachments?: Attachment[]; error?: string };
      if (!res.ok || !body.attachments) throw new Error(body.error ?? "Upload failed. Try again.");
      onChange([...attachments, ...body.attachments]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async (a: Attachment) => {
    if (!window.confirm(`Delete "${a.name}"? This can't be undone.`)) return;
    setError(null);
    const res = await fetch(`/api/attachments/${a.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setError("Couldn't delete that file. Try again.");
    onChange(attachments.filter((x) => x.id !== a.id));
  };

  return (
    <div className="field">
      Attachments
      {attachments.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {attachments.map((a) => (
            <li key={a.id} className="flex items-center gap-2 rounded-lg border border-line bg-soft px-2.5 py-1.5 font-normal">
              <span aria-hidden="true">{iconFor(a.type)}</span>
              <a
                href={`/api/attachments/${a.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate text-[14px] text-ocean underline-offset-2 hover:underline"
                title={a.name}
              >
                {a.name}
              </a>
              <span className="shrink-0 text-[12px] text-muted">{formatSize(a.size)}</span>
              <button
                type="button"
                onClick={() => remove(a)}
                aria-label={`Delete ${a.name}`}
                className="shrink-0 cursor-pointer px-1 text-[18px] leading-none text-muted hover:text-bad-ink"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {stopId ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn !min-h-9 !text-[13px]"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? "Uploading…" : "Add files"}
          </button>
          <span className="text-[12px] font-normal text-muted">Tickets, bookings, photos. Up to 10 MB each.</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => e.target.files && void upload(e.target.files)}
          />
        </div>
      ) : (
        <p className="mt-1 text-[12.5px] font-normal text-muted">Save the stop first, then add files.</p>
      )}
      {error && <p className="mt-1 text-[12.5px] font-normal text-bad-ink">{error}</p>}
    </div>
  );
}
