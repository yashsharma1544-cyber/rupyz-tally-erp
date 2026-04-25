"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromPath = searchParams.get("from") || "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    router.replace(fromPath);
    router.refresh();
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 relative">
      {/* Left: form */}
      <div className="flex items-center justify-center px-6 py-12 relative z-10">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-2 w-2 rounded-full bg-accent" />
              <span className="text-2xs uppercase tracking-[0.2em] text-ink-muted">Sushil Agencies</span>
            </div>
            <h1 className="font-bold text-3xl tracking-tight">Sign in to ERP</h1>
            <p className="text-sm text-ink-muted mt-1">Order management & Tally bridge</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5"
                disabled={busy}
              />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5"
                disabled={busy}
              />
            </div>
            <Button type="submit" disabled={busy} className="w-full mt-2" size="lg">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="text-xs text-ink-subtle mt-8 leading-relaxed">
            Access is invite-only. Contact your administrator to be added.
          </p>
        </div>
      </div>

      {/* Right: brand panel */}
      <div className="hidden lg:flex bg-ink text-paper relative overflow-hidden items-center justify-center p-12">
        <div className="absolute inset-0 opacity-[0.04] pointer-events-none"
          style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.5) 1px, transparent 1px)", backgroundSize: "4px 4px" }}
        />
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-accent/30 blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full bg-accent/20 blur-3xl" />

        <div className="relative z-10 max-w-md">
          <div className="text-paper/60 text-2xs uppercase tracking-[0.3em] mb-6">v0.1 · Phase 1.5</div>
          <h2 className="text-4xl font-bold leading-tight mb-4">
            From Rupyz to dispatch — <span className="text-accent">in one place.</span>
          </h2>
          <p className="text-paper/70 leading-relaxed mb-8">
            Orders flow in every 15 minutes. Approve on credit. Dispatch in parts. Match Tally invoices.
            Your team works the queue, not the spreadsheets.
          </p>
          <div className="grid grid-cols-3 gap-px bg-paper/10">
            {[
              { label: "Customers", value: "1,096" },
              { label: "SKUs",      value: "43" },
              { label: "Beats",     value: "23" },
            ].map((s) => (
              <div key={s.label} className="bg-ink p-4">
                <div className="tabular text-2xl font-bold">{s.value}</div>
                <div className="text-2xs uppercase tracking-wide text-paper/50 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
