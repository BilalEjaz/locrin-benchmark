import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hashTrustedToken } from "@/lib/trusted-device";

// Dipakai semua halaman dashboard, server action, export, dan admin: user wajib login, dan kalau MFA aktif
// sesi harus sudah aal2 (atau perangkat ini sudah dipercaya).
export const getDashboardContext = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const cookieStore = await cookies();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
    const token = cookieStore.get("trusted_device")?.value;
    const { data: trusted } = token ? await supabase.from("trusted_devices").select("id").eq("user_id", user.id).eq("token_hash", await hashTrustedToken(token)).gt("expires_at", new Date().toISOString()).maybeSingle() : { data: null };
    if (!trusted) redirect("/login/mfa");
  }
  const [{ data: linktrees }, { data: account }] = await Promise.all([
    supabase.from("linktrees").select("id,name,slug,avatar_url,created_at").eq("owner_id", user.id).order("created_at"),
    supabase.from("profiles").select("is_admin").eq("id", user.id).single(),
  ]);
  if (!linktrees?.length) redirect("/login?error=Linktree awal belum dibuat");
  const activeId = cookieStore.get("active_linktree_id")?.value;
  const linktree = linktrees.find((item) => item.id === activeId) ?? linktrees[0];
  return { supabase, user, linktree, linktrees, isAdmin: Boolean(account?.is_admin) };
});
