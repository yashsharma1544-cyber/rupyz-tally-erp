"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Save, Loader2, Check, AlertCircle, MapPin,
} from "lucide-react";
import { saveBeatAreas } from "./actions";
import type { BeatRow } from "./page";

type Props = { beats: BeatRow[] };

export function ManageAreasClient({ beats }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // edits[id] is the in-progress area value for that beat; undefined means
  // "not yet touched". We track dirtiness against the original value.
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries(beats.map((b) => [b.id, b.area ?? ""])),
  );
  const [savingState, setSavingState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [error, setError] = useState("");
  const [savedCount, setSavedCount] = useState(0);

  // Suggestions for the datalist — every distinct area already in use,
  // plus a few common ones to seed the dropdown when starting from scratch.
  const suggestions = useMemo(() => {
    const set = new Set<string>();
    for (const b of beats) {
      if (b.area && b.area.trim().length > 0) set.add(b.area.trim());
    }
    // Seed defaults if the list is empty
    if (set.size === 0) {
      for (const s of ["Jalna", "Mehkar", "Lonar"]) set.add(s);
    }
    return Array.from(set).sort();
  }, [beats]);

  const originalById = useMemo(
    () => Object.fromEntries(beats.map((b) => [b.id, b.area ?? ""])),
    [beats],
  );

  const dirtyIds = useMemo(() => {
    return beats
      .filter((b) => (edits[b.id] ?? "") !== (originalById[b.id] ?? ""))
      .map((b) => b.id);
  }, [beats, edits, originalById]);

  const unassignedCount = beats.filter(
    (b) => !(edits[b.id] ?? "").trim(),
  ).length;

  // Distinct areas after applying in-memory edits (for the summary chip row)
  const areaCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of beats) {
      const v = (edits[b.id] ?? "").trim();
      if (v.length > 0) map.set(v, (map.get(v) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [beats, edits]);

  function setAreaFor(beatId: string, value: string) {
    setEdits((prev) => ({ ...prev, [beatId]: value }));
    setSavingState("idle");
  }

  function fillAllUnassigned(value: string) {
    if (!value.trim()) return;
    if (
      !confirm(
        `Set area to "${value}" for all ${unassignedCount} beats without an area?`,
      )
    )
      return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const b of beats) {
        if (!(next[b.id] ?? "").trim()) next[b.id] = value;
      }
      return next;
    });
    setSavingState("idle");
  }

  async function handleSave() {
    if (dirtyIds.length === 0) return;
    setSavingState("saving");
    setError("");
    setSavedCount(0);
    try {
      const payload = dirtyIds.map((id) => ({
        id,
        area: (edits[id] ?? "").trim() || null,
      }));
      const res = await saveBeatAreas(payload);
      if (res.ok) {
        setSavedCount(res.updated);
        setSavingState("saved");
        startTransition(() => router.refresh());
        setTimeout(() => setSavingState("idle"), 2500);
      } else {
        setSavingState("error");
        setError(res.error || "Save failed");
      }
    } catch (e) {
      setSavingState("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <Link
          href="/beats"
          className="text-xs text-ink-muted hover:text-ink inline-flex items-center gap-1 mb-3"
        >
          <ArrowLeft size={11} /> All beats
        </Link>

        <h1 className="text-xl font-semibold leading-tight mb-1">
          Manage Beat Areas
        </h1>
        <p className="text-sm text-ink-muted mb-5">
          Group beats into areas (e.g. Jalna, Mehkar, Lonar). Used by the
          Journey Cycle target-distribution tool — admin enters a target for
          an area, system splits it across that area&apos;s beats by historical
          share.
        </p>

        {/* Summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5">
          <div className="bg-paper-card border border-paper-line rounded-md p-3">
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">
              Beats
            </div>
            <div className="text-lg font-bold tabular">{beats.length}</div>
          </div>
          <div
            className={`bg-paper-card border ${unassignedCount > 0 ? "border-warn/30" : "border-paper-line"} rounded-md p-3`}
          >
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">
              Unassigned
            </div>
            <div
              className={`text-lg font-bold tabular ${unassignedCount > 0 ? "text-warn" : ""}`}
            >
              {unassignedCount}
            </div>
          </div>
          <div className="bg-paper-card border border-paper-line rounded-md p-3 col-span-2 sm:col-span-2">
            <div className="text-2xs uppercase tracking-wide text-ink-muted mb-1">
              Areas in use
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {areaCounts.length === 0 ? (
                <span className="text-2xs text-ink-subtle">None yet</span>
              ) : (
                areaCounts.map(([area, count]) => (
                  <span
                    key={area}
                    className="text-2xs px-1.5 py-0.5 rounded bg-paper-subtle text-ink-muted inline-flex items-center gap-1"
                  >
                    <MapPin size={9} />
                    {area} · {count}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Bulk-fill helper */}
        {unassignedCount > 0 && (
          <div className="mb-4 border border-paper-line rounded p-3 bg-paper-card">
            <div className="text-xs font-medium text-ink-muted mb-2">
              Bulk-fill {unassignedCount} unassigned beats
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => fillAllUnassigned(s)}
                  className="text-xs px-2.5 py-1 border border-paper-line rounded hover:bg-paper-subtle"
                >
                  Fill with &quot;{s}&quot;
                </button>
              ))}
            </div>
            <p className="text-2xs text-ink-subtle mt-2">
              Useful for assigning every blank row to one area at a time, then
              fixing the exceptions by hand.
            </p>
          </div>
        )}

        {/* Sticky save bar */}
        <div className="sticky top-0 z-10 mb-3 bg-paper/95 backdrop-blur border border-paper-line rounded-md p-2 flex items-center justify-between gap-2">
          <div className="text-xs text-ink-muted">
            {dirtyIds.length === 0 ? (
              <span>No unsaved changes</span>
            ) : (
              <span className="font-medium text-ink">
                {dirtyIds.length} unsaved change
                {dirtyIds.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {savingState === "saved" && (
              <span className="text-2xs text-accent flex items-center gap-1">
                <Check size={11} /> Saved {savedCount}
              </span>
            )}
            {savingState === "error" && (
              <span
                className="text-2xs text-danger flex items-center gap-1"
                title={error}
              >
                <AlertCircle size={11} /> {error.slice(0, 50)}
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={savingState === "saving" || dirtyIds.length === 0}
              className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
            >
              {savingState === "saving" ? (
                <>
                  <Loader2 size={12} className="animate-spin" /> Saving…
                </>
              ) : (
                <>
                  <Save size={12} /> Save changes
                </>
              )}
            </button>
          </div>
        </div>

        {/* Beats list */}
        <div className="border border-paper-line rounded-md bg-paper-card overflow-hidden">
          <datalist id="area-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="divide-y divide-paper-line">
            {beats.map((b) => {
              const current = edits[b.id] ?? "";
              const isDirty = current !== (b.area ?? "");
              return (
                <div
                  key={b.id}
                  className={`px-3 py-2 flex items-center gap-2 sm:gap-3 ${isDirty ? "bg-accent/5" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{b.name}</div>
                    {b.city && (
                      <div className="text-2xs text-ink-subtle">{b.city}</div>
                    )}
                  </div>
                  <input
                    list="area-suggestions"
                    type="text"
                    value={current}
                    onChange={(e) => setAreaFor(b.id, e.target.value)}
                    placeholder="Area (e.g. Jalna)"
                    className="text-xs border border-paper-line rounded px-2 py-1.5 bg-white w-32 sm:w-44 focus:outline-none focus:ring-1 focus:ring-accent/40"
                  />
                </div>
              );
            })}
          </div>
        </div>

        <p className="text-2xs text-ink-subtle mt-4">
          Tip — type a new area name and it&apos;ll show up in the suggestions
          for the next row. Consistent spelling matters (the Journey Cycle
          tool groups by exact match).
        </p>
      </div>
    </div>
  );
}
