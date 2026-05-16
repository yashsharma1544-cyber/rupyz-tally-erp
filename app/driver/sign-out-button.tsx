"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n/context";

export function SignOutButton() {
  const router = useRouter();
  const { t } = useTranslation();
  const [pending, startTransition] = useTransition();

  function handleSignOut() {
    if (!confirm(t("driver.signout_confirm"))) return;
    startTransition(async () => {
      const supabase = createClient();
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error(error.message);
        return;
      }
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={pending}
      className="text-ink-muted hover:text-ink p-2 -mr-2"
      aria-label={t("driver.signout_aria")}
    >
      <LogOut size={16}/>
    </button>
  );
}
