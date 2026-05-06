"use client";

import { useState, useTransition } from "react";
import { Plus, UserCheck, UserX, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetBody, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { AppUser, Salesman, UserRole } from "@/lib/types";
import { inviteUser, setUserActive, setUserRole, createDriver } from "./actions";
import { toast } from "sonner";

const roles: UserRole[] = ["admin", "approver", "accounts", "dispatch", "delivery", "salesman", "van_lead", "van_helper", "driver"];

export function UsersClient({ users, salesmen }: { users: AppUser[]; salesmen: Pick<Salesman, "id" | "name">[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [addingDriver, setAddingDriver] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleToggleActive(u: AppUser) {
    startTransition(async () => {
      const res = await setUserActive(u.id, !u.active);
      if (res.error) toast.error(res.error);
      else { toast.success(`User ${!u.active ? "activated" : "deactivated"}`); router.refresh(); }
    });
  }

  function handleChangeRole(u: AppUser, role: UserRole) {
    startTransition(async () => {
      const res = await setUserRole(u.id, role);
      if (res.error) toast.error(res.error);
      else { toast.success("Role updated"); router.refresh(); }
    });
  }

  return (
    <div className="p-3 sm:p-6">
      <div className="flex justify-end gap-2 mb-4">
        <Button variant="outline" onClick={() => setAddingDriver(true)}>
          <Truck size={14}/> Create driver
        </Button>
        <Button onClick={() => setAdding(true)}><Plus size={14} /> Invite User</Button>
      </div>

      <div className="bg-paper-card border border-paper-line rounded-md overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead className="bg-paper-subtle/60 border-b border-paper-line">
            <tr className="text-left text-2xs uppercase tracking-wide text-ink-muted">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-paper-line">
            {users.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-12 text-center text-ink-muted">No users yet — invite the first one.</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="hover:bg-paper-subtle/40">
                <td className="px-3 py-2 font-medium">{u.full_name}</td>
                <td className="px-3 py-2 text-ink-muted">{u.email}</td>
                <td className="px-3 py-2">
                  <Select value={u.role} onValueChange={(v) => handleChangeRole(u, v as UserRole)} disabled={pending}>
                    <SelectTrigger className="w-32 h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2">
                  {u.active ? <Badge variant="ok">Active</Badge> : <Badge variant="neutral">Inactive</Badge>}
                </td>
                <td className="px-3 py-2 text-right">
                  <Button variant="ghost" size="sm" onClick={() => handleToggleActive(u)} disabled={pending}>
                    {u.active ? <><UserX size={12}/> Deactivate</> : <><UserCheck size={12}/> Activate</>}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>

      <Sheet open={adding} onOpenChange={(o) => { if (!o) setAdding(false); }}>
        <SheetContent>
          <SheetHeader>
            <div>
              <SheetTitle>Invite user</SheetTitle>
              <SheetDescription>An email invite is sent. The user sets their own password on first sign-in.</SheetDescription>
            </div>
          </SheetHeader>
          <InviteForm salesmen={salesmen} onDone={() => { setAdding(false); router.refresh(); }} onCancel={() => setAdding(false)} />
        </SheetContent>
      </Sheet>

      <Sheet open={addingDriver} onOpenChange={(o) => { if (!o) setAddingDriver(false); }}>
        <SheetContent>
          <SheetHeader>
            <div>
              <SheetTitle>Create driver</SheetTitle>
              <SheetDescription>For truck drivers who don&apos;t have email. Set their phone &amp; password directly. Driver logs in with phone number.</SheetDescription>
            </div>
          </SheetHeader>
          <DriverForm onDone={() => { setAddingDriver(false); router.refresh(); }} onCancel={() => setAddingDriver(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function InviteForm({ salesmen, onDone, onCancel }: { salesmen: Pick<Salesman, "id" | "name">[]; onDone: () => void; onCancel: () => void }) {
  const [pending, startTransition] = useTransition();
  const [role, setRole] = useState<UserRole>("dispatch");
  const [salesmanId, setSalesmanId] = useState<string>("");

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set("role", role);
    if (salesmanId) fd.set("salesman_id", salesmanId);
    startTransition(async () => {
      const res = await inviteUser(fd);
      if (res.error) toast.error(res.error);
      else { toast.success("Invite sent"); onDone(); }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="contents">
      <SheetBody>
        <div className="space-y-4">
          <div><Label className="block mb-1">Full name</Label><Input name="full_name" required disabled={pending} /></div>
          <div><Label className="block mb-1">Email</Label><Input name="email" type="email" required disabled={pending} /></div>
          <div><Label className="block mb-1">Phone (optional)</Label><Input name="phone" placeholder="91XXXXXXXXXX" className="tabular" disabled={pending} /></div>
          <div><Label className="block mb-1">Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{roles.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {role === "salesman" && (
            <div><Label className="block mb-1">Linked salesman</Label>
              <Select value={salesmanId} onValueChange={setSalesmanId}>
                <SelectTrigger><SelectValue placeholder="Select salesman record" /></SelectTrigger>
                <SelectContent>{salesmen.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
      </SheetBody>
      <SheetFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button type="submit" disabled={pending}>{pending ? "Sending…" : "Send invite"}</Button>
      </SheetFooter>
    </form>
  );
}

function DriverForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
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
