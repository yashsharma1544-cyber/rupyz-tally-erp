"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Save, Loader2, Check, AlertCircle, MapPin, Plus,
  Pencil, Trash2, X,
} from "lucide-react";
import {
  createArea, renameArea, deleteArea, saveBeatAssignments,
} from "./actions";
import type { AreaRow, BeatRow } from "./page";

type Props = { areas: AreaRow[]; beats: BeatRow[] };

export function ManageAreasClient({ areas, beats }: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  // ---- Area-level state (per-row CRUD) ----
  const [newAreaName, setNewAreaName] = useState("");
  const [createState, setCreateState] = useState<"idle" | "saving" | "error">("idle");
  const [createError, setCreateError] = useState("");

  const [editingAreaId, setEditingAreaId] = useState<string | null>(null);
  const [editingAreaName, setEditingAreaName] = useState("");
  const [renameState, setRenameState] = useState<"idle" | "saving" | "error">("idle");
  const [renameError, setRenameError] = useState("");

  // ---- Beat-assignment state (batched save) ----
  const originalAssignments = useMemo(
    () => Object.fromEntries(beats.map((b) => [b.id, b.area_id])),
    [beats],
  );
  const [edits, setEdits] = useState<Record<string, string | null>>(
    () => originalAssignments,
  );
  const dirtyIds = useMemo(() => {
    return beats
      .filter((b) => (edits[b.id] ?? null) !== (originalAssignments[b.id] ?? null))
      .map((b) => b.id);
  }, [beats, edits, originalAssignments]);

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState("");
  const [savedCount, setSavedCount] = useState(0);

  // ---- Computed views ----
  const unassignedCount = beats.filter((b) => !(edits[b.id] ?? null)).length;

  const areaById = useMemo(() => {
    const m = new Map<string, AreaRow>();
    for (const a of areas) m.set(a.id, a);
    return m;
  }, [areas]);

  // Live counts that reflect unsaved edits, so the chips update as you assign
  const liveCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of beats) {
      const aid = edits[b.id] ?? null;
      if (aid) map.set(aid, (map.get(aid) ?? 0) + 1);
    }
    return map;
  }, [beats, edits]);

  // ---- Handlers ----
  async function handleCreateArea() {
    const name = newAreaName.trim();
    if (!name) return;
    setCreateState("saving");
    setCreateError("");
    try {
      const res = await createArea(name);
      if (res.ok) {
        setNewAreaName("");
        setCreateState("idle");
        startTransition(() => router.refresh());
      } else {
        setCreateState("error");
        setCreateError(res.error || "Create failed");
      }
    } catch (e) {
      setCreateState("error");
      setCreateError(e instanceof Error ? e.message : String(e));
    }
  }

  function startEditArea(area: AreaRow) {
    setEditingAreaId(area.id);
    setEditingAreaName(area.name);
    setRenameError("");
  }
  function cancelEditArea() {
    setEditingAreaId(null);
    setEditingAreaName("");
    setRenameError("");
  }
  async function commitRenameArea() {
    if (!editingAreaId) return;
    setRenameState("saving");
    setRenameError("");
    try {
      const res = await renameArea(editingAreaId, editingAreaName);
      if (res.ok) {
        setRenameState("idle");
        setEditingAreaId(null);
        setEditingAreaName("");
        startTransition(() => router.refresh());
      } else {
        setRenameState("error");
        setRenameError(res.error || "Rename failed");
      }
    } catch (e) {
      setRenameState("error");
      setRenameError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeleteArea(area: AreaRow) {
    const msg =
      area.beat_count > 0
        ? `Delete "${area.name}"? ${area.beat_count} beat${area.beat_count === 1 ? "" : "s"} currently assigned will become unassigned. (Beats themselves are not deleted.)`
        : `Delete "${area.name}"?`;
    if (!confirm(msg)) return;
    try {
      const res = await deleteArea(area.id);
      if (res.ok) {
        // Wipe any in-progress edits pointing at this id
        setEdits((prev) => {
          const next = { ...prev };
          for (const k of Object.keys(next)) {
            if (next[k] === area.id) next[k] = null;
          }
          return next;
        });
        startTransition(() => router.refresh());
      } else {
        alert(`Couldn't delete: ${res.error}`);
      }
    } catch (e) {
      alert(`Couldn't delete: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function setBeatArea(beatId: string, areaId: string | null) {
    setEdits((prev) => ({ ...prev, [beatId]: areaId }));
    setSaveState("idle");
  }

  function bulkAssignUnassigned(areaId: string) {
    const area = areaById.get(areaId);
    if (!area) return;
    if (
      !confirm(
        `Assign all ${unassignedCount} unassigned beats to "${area.name}"?`,
      )
    )
      return;
    setEdits((prev) => {
      const next = { ...prev };
      for (const b of beats) {
        if (!(next[b.id] ?? null)) next[b.id] = areaId;
      }
      return next;
    });
    setSaveState("idle");
  }

  async function handleSaveAssignments() {
    if (dirtyIds.length === 0) return;
    setSaveState("saving");
    setSaveError("");
    setSavedCount(0);
    try {
      const payload = dirtyIds.map((id) => ({
        beat_id: id,
        area_id: edits[id] ?? null,
      }));
      const res = await saveBeatAssignments(payload);
      if (res.ok) {
        setSavedCount(res.updated);
        setSaveState("saved");
        startTransition(() => router.refresh());
        setTimeout(() => setSaveState("idle"), 2500);
      } else {
        setSaveState("error");
        setSaveError(res.error || "Save failed");
      }
    } catch (e) {
      setSaveState("error");
      setSaveError(e instanceof Error ? e.message : String(e));
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
          Group beats into areas (Jalna, Mehkar, Lonar, etc.). Used by the
          Journey Cycle target-distribution tool — admin enters a target for an
          area and the system splits it across that area&apos;s beats by
          historical share.
        </p>

        {/* ============ AREAS SECTION ============ */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide mb-2">
            Areas ({areas.length})
          </h2>

          <div className="border border-paper-line rounded-md bg-paper-card overflow-hidden">
            {areas.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-ink-muted">
                No areas yet. Create one below.
              </div>
            ) : (
              <div className="divide-y divide-paper-line">
                {areas.map((a) => {
                  const liveCount = liveCounts.get(a.id) ?? 0;
                  const isEditing = editingAreaId === a.id;
                  return (
                    <div
                      key={a.id}
                      className="px-3 py-2 flex items-center gap-2"
                    >
                      <MapPin size={12} className="text-ink-subtle shrink-0" />
                      {isEditing ? (
                        <input
                          autoFocus
                          type="text"
                          value={editingAreaName}
                          onChange={(e) => setEditingAreaName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRenameArea();
                            if (e.key === "Escape") cancelEditArea();
                          }}
                          className="text-sm border border-paper-line rounded px-2 py-1 bg-white flex-1"
                        />
                      ) : (
                        <span className="text-sm font-medium flex-1">{a.name}</span>
                      )}
                      <span className="text-2xs text-ink-subtle px-1.5 py-0.5 rounded bg-paper-subtle">
                        {liveCount} beat{liveCount === 1 ? "" : "s"}
                      </span>
                      {isEditing ? (
                        <>
                          <button
                            onClick={commitRenameArea}
                            disabled={renameState === "saving"}
                            className="p-1 text-accent hover:bg-accent/10 rounded"
                            title="Save"
                          >
                            {renameState === "saving" ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Check size={12} />
                            )}
                          </button>
                          <button
                            onClick={cancelEditArea}
                            className="p-1 text-ink-subtle hover:bg-paper-subtle rounded"
                            title="Cancel"
                          >
                            <X size={12} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEditArea(a)}
                            className="p-1 text-ink-subtle hover:text-ink hover:bg-paper-subtle rounded"
                            title="Rename"
                          >
                            <Pencil size={11} />
                          </button>
                          {unassignedCount > 0 && (
                            <button
                              onClick={() => bulkAssignUnassigned(a.id)}
                              className="text-2xs px-2 py-0.5 rounded border border-paper-line hover:bg-paper-subtle whitespace-nowrap"
                              title={`Assign all ${unassignedCount} unassigned beats to ${a.name}`}
                            >
                              Fill blanks
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteArea(a)}
                            className="p-1 text-ink-subtle hover:text-danger hover:bg-danger/10 rounded"
                            title="Delete"
                          >
                            <Trash2 size={11} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {renameError && (
              <div className="px-3 py-1.5 text-2xs text-danger bg-danger/5 border-t border-paper-line">
                <AlertCircle size={10} className="inline mr-1" /> {renameError}
              </div>
            )}

            {/* Create-area form */}
            <div className="px-3 py-2 border-t border-paper-line bg-paper-subtle/30 flex items-center gap-2">
              <Plus size={12} className="text-ink-subtle shrink-0" />
              <input
                type="text"
                placeholder="New area name (e.g. Jalna)"
                value={newAreaName}
                onChange={(e) => setNewAreaName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateArea();
                }}
                className="text-xs border border-paper-line rounded px-2 py-1 bg-white flex-1"
              />
              <button
                onClick={handleCreateArea}
                disabled={createState === "saving" || !newAreaName.trim()}
                className="inline-flex items-center gap-1 text-xs px-3 py-1 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
              >
                {createState === "saving" ? (
                  <Loader2 size={11} className="animate-spin" />
                ) : (
                  <Plus size={11} />
                )}
                Create
              </button>
            </div>
            {createError && (
              <div className="px-3 py-1.5 text-2xs text-danger bg-danger/5 border-t border-paper-line">
                <AlertCircle size={10} className="inline mr-1" /> {createError}
              </div>
            )}
          </div>
        </section>

        {/* ============ BEATS ASSIGNMENT SECTION ============ */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold text-ink-muted uppercase tracking-wide">
              Beats ({beats.length})
            </h2>
            <div className="text-2xs text-ink-subtle">
              {unassignedCount} unassigned
            </div>
          </div>

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
              {saveState === "saved" && (
                <span className="text-2xs text-accent flex items-center gap-1">
                  <Check size={11} /> Saved {savedCount}
                </span>
              )}
              {saveState === "error" && (
                <span
                  className="text-2xs text-danger flex items-center gap-1"
                  title={saveError}
                >
                  <AlertCircle size={11} /> {saveError.slice(0, 60)}
                </span>
              )}
              <button
                onClick={handleSaveAssignments}
                disabled={saveState === "saving" || dirtyIds.length === 0}
                className="inline-flex items-center gap-1 text-xs px-3 py-1.5 bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50"
              >
                {saveState === "saving" ? (
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

          <div className="border border-paper-line rounded-md bg-paper-card overflow-hidden">
            {beats.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-ink-muted">
                No beats configured yet.
              </div>
            ) : (
              <div className="divide-y divide-paper-line">
                {beats.map((b) => {
                  const current = edits[b.id] ?? null;
                  const isDirty = current !== (b.area_id ?? null);
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
                      <select
                        value={current ?? ""}
                        onChange={(e) =>
                          setBeatArea(b.id, e.target.value || null)
                        }
                        className="text-xs border border-paper-line rounded px-2 py-1.5 bg-white w-36 sm:w-44"
                      >
                        <option value="">— Unassigned —</option>
                        {areas.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-2xs text-ink-subtle mt-3">
            Tip — create your areas first, then use the &quot;Fill blanks&quot;
            button on an area to bulk-assign every unassigned beat to it. Fix
            outliers individually after.
          </p>
        </section>
      </div>
    </div>
  );
}
