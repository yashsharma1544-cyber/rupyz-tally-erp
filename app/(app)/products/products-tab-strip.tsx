"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, TrendingUp } from "lucide-react";

const TABS = [
  { href: "/products",          label: "Catalog",  icon: Package },
  { href: "/products/insights", label: "Insights", icon: TrendingUp },
] as const;

export function ProductsTabStrip() {
  const pathname = usePathname();

  function isActive(href: string): boolean {
    if (pathname === href) return true;
    // /products/insights/<id> still highlights "Insights"
    if (href === "/products/insights" && pathname.startsWith("/products/insights")) return true;
    // /products (Catalog) — exact match only, since /products is parent of insights routes
    return false;
  }

  return (
    <div className="border-b border-paper-line bg-paper-card/40">
      <div className="max-w-5xl mx-auto px-3 lg:px-6">
        <div className="flex items-center gap-1">
          {TABS.map(t => {
            const active = isActive(t.href);
            const Icon = t.icon;
            return (
              <Link
                key={t.href}
                href={t.href}
                prefetch
                className={
                  "inline-flex items-center gap-1.5 px-3 py-2.5 text-sm border-b-2 -mb-px transition-colors " +
                  (active
                    ? "border-accent text-ink font-semibold"
                    : "border-transparent text-ink-muted hover:text-ink")
                }
              >
                <Icon size={13}/>
                {t.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
