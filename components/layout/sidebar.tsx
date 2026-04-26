"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <aside className="w-56 shrink-0 border-r border-paper-line bg-paper-card/60 flex flex-col h-screen sticky top-0">
      {/* Brand */}
      <div className="px-4 pt-4 pb-3 border-b border-paper-line">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded bg-ink text-paper flex items-center justify-center">
            <span className="font-bold text-xs tracking-tight">SA</span>
          </div>
          <div className="leading-tight">
            <div className="font-semibold text-sm">Sushil Agencies</div>
            <div className="text-2xs text-ink-subtle uppercase tracking-wider">Rupyz · Tally ERP</div>
          </div>
        </div>
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
                "flex items-center gap-2.5 px-2.5 py-1.5 rounded text-sm transition-all",
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
    </aside>
  );
}
