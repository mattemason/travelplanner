"use client";

import { useState } from "react";
import type { Profile } from "@/lib/profile";
import { FUEL_TYPES, type FuelType } from "@/lib/trip/fuel";
import { saveProfile } from "./actions";

export function ProfileForm({ initial }: { initial: Profile }) {
  const [v, setV] = useState({
    name: initial.name,
    about: initial.about,
    vehicle: initial.vehicle,
    lPer100km: initial.lPer100km === null ? "" : String(initial.lPer100km),
    fuelType: initial.fuelType ?? "",
  });
  const [status, setStatus] = useState<{ kind: "saved" | "error"; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        setStatus(null);
        try {
          const r = await saveProfile({
            name: v.name,
            about: v.about,
            vehicle: v.vehicle,
            lPer100km: v.lPer100km.trim() ? Number(v.lPer100km) : null,
            fuelType: (v.fuelType || null) as FuelType | null,
          });
          setStatus(r.ok ? { kind: "saved", text: "Saved." } : { kind: "error", text: r.error });
        } catch {
          setStatus({ kind: "error", text: "Couldn't save. Try again." });
        } finally {
          setSaving(false);
        }
      }}
    >
      <section className="rounded-2xl border border-line bg-paper p-4">
        <h2 className="text-[22px] font-bold">About me</h2>
        <label className="field">
          Name
          <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoComplete="name" />
        </label>
        <label className="field !mb-0">
          About me
          <textarea
            rows={4}
            value={v.about}
            onChange={(e) => setV({ ...v, about: e.target.value })}
            placeholder="How you like to travel, driving experience, anything the planner should know"
          />
        </label>
      </section>

      <section className="rounded-2xl border border-line bg-paper p-4">
        <h2 className="text-[22px] font-bold">Vehicle</h2>
        <p className="text-[13px] text-muted">Used to estimate each day&apos;s fuel cost, with the fuel prices set on each trip.</p>
        <label className="field">
          Vehicle
          <input
            value={v.vehicle}
            onChange={(e) => setV({ ...v, vehicle: e.target.value })}
            placeholder="e.g. 2019 Toyota LandCruiser 200"
          />
        </label>
        <div className="grid grid-cols-2 gap-2.5">
          <label className="field !mb-0">
            Fuel use (L/100 km)
            <input
              type="number"
              inputMode="decimal"
              min={1}
              max={60}
              step={0.1}
              value={v.lPer100km}
              onChange={(e) => setV({ ...v, lPer100km: e.target.value })}
              placeholder="e.g. 12.5"
            />
          </label>
          <label className="field !mb-0">
            Fuel type
            <select value={v.fuelType} onChange={(e) => setV({ ...v, fuelType: e.target.value })}>
              <option value="">Choose…</option>
              {FUEL_TYPES.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {status && (
        <p role="status" className={`notice ${status.kind === "saved" ? "bg-good-bg text-good-ink" : "notice-bad"}`}>
          {status.text}
        </p>
      )}
      <button type="submit" className="btn btn-primary self-start" disabled={saving}>
        {saving ? "Saving…" : "Save profile"}
      </button>
    </form>
  );
}
