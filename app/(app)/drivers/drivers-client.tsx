"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Truck, Key, Eye, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody, SheetFooter } from "@/components/ui/sheet";
import { toast } from "sonner";
import { createDriver, resetDriverPassword } from "@/app/(app)/users/actions";
import { setUserActive } from "@/app/(app)/users/actions";

interface DriverRow {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  created_at: string;
  delivered_count: number;
  loading_count: number;
}

export function DriversClient({ drivers }: { drivers: DriverRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [resetTarget, setResetTarget] = useState<DriverRow | null>(null);
  const [pending, startTransition] = useTransition();

  function handleToggleActive(d: DriverRow) {
    if (!confirm(d.active ? `Deactivate ${d.full_name}? They won't be able to log in.` : `Reactivate ${d.full_name}?`)) return;
    startTransition(async () => {
      const res = await setUserActive(d.id, !d.active);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(d.active ? `${d.full_name} deactivated` : `${d.full_name} reactivated`);
      router.refresh();
    });
  }

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-baseline justify-between mb-1 flex-wrap gap-2">
          <h1 className="text-xl font-semibold leading-tight inline-flex items-center gap-2">
            <Truck size={18} className="text-accent"/> Drivers
          </h1>
          <Button onClick={() => setAdding(true)}>
            <Plus size={14}/> Add driver
          </Button>
        </div>
        <p className="text-sm text-ink-muted mb-5">
          Truck drivers with delivery app access. They log in with phone number + password.
        </p>

        {drivers.length === 0 ? (
          <div className="bg-paper-card border border-paper-line rounded-md p-8 text-center">
            <Truck size={32} className="mx-auto text-ink-subtle mb-2"/>
            <p className="font-semibold text-sm mb-0.5">No drivers yet</p>
            <p className="text-xs text-ink-muted mb-4">Add your first driver — they&apos;ll get login credentials and access to the driver app.</p>
            <Button onClick={() => setAdding(true)}>
              <Plus size={14}/> Add driver
            </Button>
          </div>
        ) : (
          <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-paper-subtle/50">
                <tr className="text-2xs uppercase tracking-wide text-ink-muted">
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Phone</th>
                  <th className="text-left px-3 py-2">Active work</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-right px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map(d => (
                  <tr key={d.id} className="border-t border-paper-line">
                    <td className="px-3 py-2.5 font-medium">{d.full_name}</td>
                    <td className="px-3 py-2.5 font-mono text-xs">{d.phone ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs">
                      {d.loading_count > 0 ? (
                        <span className="text-warn font-semibold tabular">{d.loading_count} on truck</span>
                      ) : (
                        <span className="text-ink-subtle">none</span>
                      )}
                      {d.delivered_count > 0 && (
                        <span className="text-ink-muted ml-1.5">· <span className="tabular">{d.delivered_count}</span> delivered</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {d.active ? <Badge variant="ok">active</Badge> : <Badge variant="danger">inactive</Badge>}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="inline-flex items-center gap-1 flex-wrap justify-end">
                        <Link
                          href={`/trucks?driver=${d.id}`}
                          className="text-xs text-accent inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-accent-soft"
                        >
                          <Eye size={11}/> Trips
                        </Link>
                        <button
                          type="button"
                          onClick={() => setResetTarget(d)}
                          className="text-xs text-ink-muted inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-paper-subtle"
                          title="Reset password"
                        >
                          <Key size={11}/> Reset
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleActive(d)}
                          disabled={pending}
                          className="text-xs text-ink-muted inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-paper-subtle"
                          title={d.active ? "Deactivate" : "Reactivate"}
                        >
                          {d.active ? <UserX size={11}/> : <UserCheck size={11}/>}
                          {d.active ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add driver sheet */}
      <Sheet open={adding} onOpenChange={(o) => { if (!o) setAdding(false); }}>
        <SheetContent>
          <SheetHeader>
            <div>
              <SheetTitle>Add driver</SheetTitle>
              <SheetDescription>
                For truck drivers who don&apos;t have email. Set their phone &amp; password directly. Driver logs in with phone number.
              </SheetDescription>
            </div>
          </SheetHeader>
          <AddDriverForm onDone={() => { setAdding(false); router.refresh(); }} onCancel={() => setAdding(false)} />
        </SheetContent>
      </Sheet>

      {/* Reset password sheet */}
      <Sheet open={!!resetTarget} onOpenChange={(o) => { if (!o) setResetTarget(null); }}>
        <SheetContent>
          <SheetHeader>
            <div>
              <SheetTitle>Reset password</SheetTitle>
              <SheetDescription>
                {resetTarget && <>Set a new password for <strong>{resetTarget.full_name}</strong>. Hand it to the driver — they&apos;ll use it to log in.</>}
              </SheetDescription>
            </div>
          </SheetHeader>
          {resetTarget && (
            <ResetPasswordForm
              driver={resetTarget}
              onDone={() => { setResetTarget(null); router.refresh(); }}
              onCancel={() => setResetTarget(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AddDriverForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createDriver(fd);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Driver created — login with phone ${res.phone}`);
      onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="contents">
      <SheetBody>
        <div className="space-y-4">
          <div>
            <Label className="block mb-1">Driver name</Label>
            <Input name="full_name" required disabled={pending} placeholder="e.g. Ramesh Kumar" />
          </div>
          <div>
            <Label className="block mb-1">Phone number</Label>
            <Input
              name="phone"
              required
              inputMode="tel"
              disabled={pending}
              placeholder="9876543210"
              className="tabular"
            />
            <p className="text-2xs text-ink-muted mt-1">Driver will use this number to log in.</p>
          </div>
          <div>
            <Label className="block mb-1">Password</Label>
            <Input
              name="password"
              type="text"
              required
              disabled={pending}
              placeholder="At least 6 characters"
              minLength={6}
            />
            <p className="text-2xs text-ink-muted mt-1">Hand this to the driver. They&apos;ll use it to log in.</p>
          </div>
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create driver"}</Button>
      </SheetFooter>
    </form>
  );
}

function ResetPasswordForm({
  driver, onDone, onCancel,
}: {
  driver: DriverRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    startTransition(async () => {
      const res = await resetDriverPassword(driver.id, password);
      if ("error" in res && res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Password reset for ${driver.full_name}`);
      onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="contents">
      <SheetBody>
        <div className="space-y-4">
          <div>
            <Label className="block mb-1">New password</Label>
            <Input
              type="text"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              disabled={pending}
              placeholder="At least 6 characters"
              minLength={6}
              autoFocus
            />
            <p className="text-2xs text-ink-muted mt-1">
              Driver: <strong className="font-mono">{driver.phone}</strong> · {driver.full_name}
            </p>
          </div>
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending || password.length < 6}>{pending ? "Resetting…" : "Reset password"}</Button>
      </SheetFooter>
    </form>
  );
}
