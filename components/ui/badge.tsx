import { cn } from "@/lib/utils";
import * as React from "react";

type Variant = "neutral" | "ok" | "warn" | "danger" | "accent";

const variants: Record<Variant, string> = {
  neutral: "bg-paper-subtle text-ink-muted",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  accent: "bg-accent-soft text-accent",
};

export function Badge({
  variant = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}
