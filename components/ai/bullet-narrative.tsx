/**
 * Renders Claude's "intro line + bullets" output as HTML.
 *
 * Claude is instructed to output:
 *   Opening sentence on first line(s).
 *   - bullet one
 *   - bullet two
 *   - bullet three
 *
 * We split on the first "- " bullet marker and render the rest as a list.
 * Stray asterisks/bold markdown are stripped — we want clean output.
 */

"use client";

import React from "react";

function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")  // bold
    .replace(/\*(.+?)\*/g, "$1")      // italic
    .replace(/`(.+?)`/g, "$1")        // inline code
    .trim();
}

export function BulletNarrative({ text }: { text: string }) {
  // Split by lines, find first bullet line
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const firstBulletIdx = lines.findIndex(l => /^[-•*]\s/.test(l));

  // Everything before first bullet is the intro
  const introLines = firstBulletIdx >= 0 ? lines.slice(0, firstBulletIdx) : lines;
  const bulletLines = firstBulletIdx >= 0 ? lines.slice(firstBulletIdx) : [];

  // Extract each bullet's content
  const bullets: string[] = [];
  for (const line of bulletLines) {
    const m = line.match(/^[-•*]\s+(.+)$/);
    if (m) bullets.push(stripMarkdown(m[1]));
    else if (bullets.length > 0) {
      // continuation line — append to last bullet
      bullets[bullets.length - 1] += " " + stripMarkdown(line);
    }
  }

  const intro = introLines.length > 0 ? stripMarkdown(introLines.join(" ")) : "";

  // No bullets parsed — render plain text as fallback
  if (bullets.length === 0) {
    return <p className="text-sm leading-relaxed whitespace-pre-wrap">{stripMarkdown(text)}</p>;
  }

  return (
    <div className="space-y-2">
      {intro && <p className="text-sm leading-relaxed">{intro}</p>}
      <ul className="space-y-1.5 text-sm leading-relaxed">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-accent shrink-0 mt-1.5 w-1 h-1 rounded-full bg-accent" aria-hidden />
            <span className="flex-1">{b}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
