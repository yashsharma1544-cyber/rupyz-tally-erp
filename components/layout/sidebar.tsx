"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  ShoppingBag,
  Truck,
  Route,
  Users2,
  Package,
  UserCircle2,
  MapPin,
  Shield,
  Settings,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import type { AppUser } from "@/lib/types";

const navItems = [
  { href: "/dashboard",  label: "Dashboard",  icon: LayoutDashboard, roles: "all" },
  { href: "/orders",     label: "Orders",     icon: ShoppingBag,     roles: "all" },
  { href: "/dispatches", label: "Dispatches", icon: Truck,           roles: "all" },
  { href: "/trips",      label: "VAN Trips",  icon: Route,           roles: "all" },
  { href: "/customers",  label: "Customers",  icon: Users2,          roles: "all" },
  { href: "/products",   label: "Products",   icon: Package,         roles: "all" },
  { href: "/salesmen",   label: "Salesmen",   icon: UserCircle2,     roles: "all" },
  { href: "/beats",      label: "Beats",      icon: MapPin,          roles: "all" },
  { href: "/users",      label: "Users",      icon: Shield,          roles: "admin" },
  { href: "/settings",   label: "Settings",   icon: Settings,        roles: "admin" },
] as const;

export function Sidebar({ user }: { user: AppUser }) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close drawer when navigation completes
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const navContent = (
    <>
      {/* Brand */}
      <div className="px-4 pt-4 pb-3 border-b border-paper-line flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded bg-ink text-paper flex items-center justify-center">
            <span className="font-bold text-xs tracking-tight">SA</span>
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-sm">Sushil Agencies</div>
            <div className="text-2xs text-ink-subtle uppercase tracking-wider">Rupyz · Tally ERP</div>
          </div>
        </div>
        {/* Close button — mobile drawer only */}
        <button
          onClick={() => setMobileOpen(false)}
          className="lg:hidden text-ink-muted hover:text-ink p-1"
          aria-label="Close menu"
        >
          <X size={16} />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          if (item.roles === "admin" && user.role !== "admin") return null;
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch
              className={cn(
                "flex items-center gap-2.5 px-2.5 py-2.5 lg:py-1.5 rounded text-sm transition-all",
                active
                  ? "bg-accent text-white shadow-sm"
                  : "text-ink-muted hover:text-ink hover:bg-paper-subtle"
              )}
            >
              <Icon size={15} className={active ? "" : "text-ink-subtle"} />
              <span className="font-medium">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* User card */}
      <div className="border-t border-paper-line p-3">
        <div className="flex items-center gap-2.5 mb-2">
          <div className="h-8 w-8 rounded-full bg-accent-soft text-accent flex items-center justify-center font-semibold text-sm shrink-0">
            {user.full_name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium truncate">{user.full_name}</div>
            <div className="text-2xs text-ink-subtle uppercase tracking-wide">{user.role}</div>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-ink-muted hover:text-danger hover:bg-danger-soft transition-colors"
        >
          <LogOut size={13} />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile / tablet top bar — visible <1024px (lg breakpoint) */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center justify-between bg-paper-card/95 backdrop-blur border-b border-paper-line px-3 py-2">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1.5 -ml-1.5 text-ink-muted hover:text-ink"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded bg-ink text-paper flex items-center justify-center">
            <span className="font-bold text-2xs tracking-tight">SA</span>
          </div>
          <span className="font-semibold text-sm">Sushil Agencies</span>
        </div>
        <div className="w-7"/>{/* spacer for balance */}
      </div>

      {/* Sidebar — desktop sticky aside, mobile drawer */}
      <aside
        className={cn(
          "border-r border-paper-line bg-paper-card flex flex-col h-screen",
          // Desktop ≥1024px: classic sidebar
          "lg:sticky lg:top-0 lg:w-56 lg:shrink-0 lg:bg-paper-card/60",
          // Mobile/tablet: slide-in drawer over content
          "fixed top-0 left-0 z-50 w-72 max-w-[85vw] transition-transform duration-200 ease-out shadow-xl lg:shadow-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {navContent}
      </aside>

      {/* Backdrop for mobile drawer */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-40"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  );
}
