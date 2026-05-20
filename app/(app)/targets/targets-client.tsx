"use client";

import { useState, useMemo } from "react";
import { MapPin, Search } from "lucide-react";
import { BeatTargetAllocator } from "./beat-target-allocator";

type Beat = { id: string; name: string; city: string | null };
type Cycle = { id: string; jc_number: number; start_date: string; end_date: string };

export function TargetsClient({ beats, cycles }: { beats: Beat[]; cycles: Cycle[] }) {
  const [selectedBeatId, setSelectedBeatId] = useState<string>("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return beats;
    return beats.filter(
      (b) => b.name.toLowerCase().includes(q) || (b.city ?? "").toLowerCase().includes(q),
    );
  }, [beats, search]);

  const selectedBeat = beats.find((b) => b.id === selectedBeatId) ?? null;

  return (
    <div className="space-y-4">
      {/* Beat picker */}
      <div className="bg-paper-card border border-paper-line rounded-md p-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-subtle" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search beats…"
              className="w-full pl-8 pr-2 py-1.5 text-sm border border-paper-line rounded bg-paper-card focus:outline-none focus:border-accent"
            />
          </div>
          <span className="text-2xs text-ink-subtle ml-auto">{filtered.length} beats</span>
        </div>
        <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto">
          {filtered.map((b) => {
            const active = b.id === selectedBeatId;
            return (
              <button
                key={b.id}
                onClick={() => setSelectedBeatId(b.id)}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border transition-colors ${
                  active
                    ? "bg-accent text-white border-accent"
                    : "bg-paper-card border-paper-line text-ink-muted hover:bg-paper-subtle hover:text-ink"
                }`}
              >
                <MapPin size={11} className={active ? "" : "text-ink-subtle"} />
                {b.name}
                {b.city && <span className={active ? "text-white/70" : "text-ink-subtle"}>· {b.city}</span>}
              </button>
            );
          })}
          {filtered.length === 0 && (
            <span className="text-sm text-ink-muted py-2">No beats match.</span>
          )}
        </div>
      </div>

      {/* Allocator for the chosen beat */}
      {selectedBeat ? (
        <BeatTargetAllocator
          key={selectedBeat.id}
          beatId={selectedBeat.id}
          beatName={selectedBeat.name}
          cycles={cycles}
        />
      ) : (
        <div className="bg-paper-card border border-dashed border-paper-line rounded-md p-8 text-center">
          <MapPin size={20} className="text-ink-subtle mx-auto mb-2" />
          <p className="text-sm font-medium">Pick a beat to set its target</p>
          <p className="text-xs text-ink-muted mt-0.5">Select a beat above to allocate a cycle target across its customers.</p>
        </div>
      )}
    </div>
  );
}
