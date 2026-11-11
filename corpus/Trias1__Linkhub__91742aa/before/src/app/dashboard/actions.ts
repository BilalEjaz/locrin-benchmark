"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDashboardContext } from "@/lib/active-linktree";
import { createClient } from "@/lib/supabase/server";
import { themes, type ThemePreset } from "@/lib/themes";
import { priceDigits } from "@/lib/rupiah";
import { commercePlatforms, detectPlatform, isCommercePlatform } from "@/lib/commerce-platforms";
import { hashTrustedToken } from "@/lib/trusted-device";
import { isUuid } from "@/lib/security";

async function authenticatedClient() {
  return getDashboardContext();
}

function validUrl(value: FormDataEntryValue | null) {
  const url = new URL(String(value ?? ""));
  if (!["http:", "https:", "mailto:"].includes(url.protocol)) throw new Error("URL tidak valid");
  return url.toString();
}



// Jenis file ditentukan dari isi (magic bytes), bukan dari File.type yang dikirim browser.
function imageType(bytes: Uint8Array) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", extension: "jpg" };
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return { type: "image/png", extension: "png" };
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { type: "image/webp", extension: "webp" };
  return null;
}

async function uploadProductImage(supabase: Awaited<ReturnType<typeof createClient>>, userId: string, value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) return null;
  const image = value.size <= 5 * 1024 * 1024 ? imageType(new Uint8Array(await value.slice(0, 12).arrayBuffer())) : null;
  if (!image) redirect("/dashboard/shops?error=Gambar harus JPG, PNG, atau WebP maksimal 5MB");
  const path = `${userId}/${crypto.randomUUID()}.${image.extension}`;
  const { error } = await supabase.storage.from("product-images").upload(path, value, { contentType: image.type, upsert: false });
  if (error) redirect(`/dashboard/shops?error=${encodeURIComponent("Gambar gagal diunggah. Coba lagi.")}`);
  return { path, url: supabase.storage.from("product-images").getPublicUrl(path).data.publicUrl };
}
// Pesan database mentah tidak ditampilkan ke user.
function friendlyError(error: { code?: string; message: string }) {
  if (error.code === "23505") return "Data itu sudah dipakai. Coba nama atau slug lain.";
  if (error.code === "42501") return "Kamu tidak punya akses untuk mengubah data ini.";
  if (error.code === "PGRST204" || error.code === "42703") return "Database belum diperbarui. Jalankan file SQL terbaru di Supabase.";
  if (error.code === "23514") return "Isian tidak valid. Periksa lagi panjang teks atau format link.";
  return "Gagal menyimpan. Coba lagi beberapa saat lagi.";
}

function validColor(value: FormDataEntryValue | null) {
  const color = String(value ?? "").toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(color)) redirect("/dashboard/design?error=Warna tidak valid");
  return color;
}

export async function saveAccount(formData: FormData) {
  const { supabase, user, linktree } = await authenticatedClient();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) redirect("/dashboard/account?error=Slug harus 3-40 karakter");
  const photo = String(formData.get("avatar_url") ?? "").trim();
  if (photo) {
    try { if (!["http:", "https:"].includes(new URL(photo).protocol)) throw new Error(); }
    catch { redirect("/dashboard/account?error=URL foto harus memakai http atau https"); }
  }
  const { error } = await supabase.from("linktrees").update({ name: String(formData.get("name") ?? "").trim().slice(0, 60), slug, avatar_url: photo || null }).eq("id", linktree.id).eq("owner_id", user.id);
  if (error) redirect(`/dashboard/account?error=${encodeURIComponent(friendlyError(error))}`);
  revalidatePath("/dashboard", "layout");
  revalidatePath(`/${slug}`);
  redirect("/dashboard/account?message=Profil disimpan");
}

export async function saveTheme(formData: FormData) {
  const { supabase, user, linktree } = await authenticatedClient();
  const preset = String(formData.get("theme_preset") ?? "peach") as ThemePreset;
  if (preset !== "custom" && !(preset in themes)) redirect("/dashboard/design?error=Tema tidak valid");
  const colors = preset === "custom" ? { background: validColor(formData.get("background_color")), text: validColor(formData.get("text_color")), button: validColor(formData.get("button_color")) } : themes[preset as keyof typeof themes];
  const { error } = await supabase.from("linktrees").update({ theme_preset: preset, background_color: colors.background, text_color: colors.text, button_color: colors.button }).eq("id", linktree.id).eq("owner_id", user.id);
  if (error) redirect(`/dashboard/design?error=${encodeURIComponent(friendlyError(error))}`);
  const { data: profile } = await supabase.from("linktrees").select("slug").eq("id", linktree.id).eq("owner_id", user.id).single();
  if (profile?.slug) revalidatePath(`/${profile.slug}`);
  redirect("/dashboard/design?message=Tema disimpan");
}

export async function addLink(formData: FormData) {
  const { supabase, user, linktree } = await authenticatedClient();
  const collectionId = String(formData.get("collection_id") ?? "") || null;
  if (collectionId) {
    const { data: collection } = isUuid(collectionId) ? await supabase.from("link_collections").select("id").eq("id", collectionId).eq("linktree_id", linktree.id).maybeSingle() : { data: null };
    if (!collection) redirect("/dashboard/links?error=Collection tidak valid");
  }
  const { count } = await supabase.from("links").select("id", { count: "exact", head: true }).eq("linktree_id", linktree.id);
  const { error } = await supabase.from("links").insert({ user_id: user.id, linktree_id: linktree.id, collection_id: collectionId, title: String(formData.get("title") ?? "").trim().slice(0, 80), url: validUrl(formData.get("url")), position: count ?? 0 });
  if (error) redirect(`/dashboard/links?error=${encodeURIComponent(friendlyError(error))}`);
  revalidatePath("/dashboard/links");
  redirect("/dashboard/links");
}

export async function updateLink(formData: FormData) {
  const { supabase, linktree } = await authenticatedClient();
  const { error } = await supabase.from("links").update({ title: String(formData.get("title") ?? "").trim().slice(0, 80), url: validUrl(formData.get("url")), is_active: formData.get("is_active") === "on" }).eq("id", String(formData.get("id") ?? "")).eq("linktree_id", linktree.id);
  if (error) redirect(`/dashboard/links?error=${encodeURIComponent(friendlyError(error))}`);
  revalidatePath("/dashboard/links");
}

export async function deleteLink(formData: FormData) {
  const { supabase, linktree } = await authenticatedClient();
  await supabase.from("links").delete().eq("id", String(formData.get("id") ?? "")).eq("linktree_id", linktree.id);
  revalidatePath("/dashboard/links");
}
export async function addCollection() {
  const { supabase, user, linktree } = await authenticatedClient();
  const { count } = await supabase.from("link_collections").select("id", { count: "exact", head: true }).eq("linktree_id", linktree.id);
  const { error } = await supabase.from("link_collections").insert({ user_id: user.id, linktree_id: linktree.id, title: "My Collection", position: count ?? 0 });
  if (error) redirect(`/dashboard/links?error=${encodeURIComponent(friendlyError(error))}`);
  revalidatePath("/dashboard/links");
  redirect("/dashboard/links");
}

export async function updateCollection(formData: FormData) {
  const { supabase, linktree } = await authenticatedClient();
  const title = String(formData.get("title") ?? "").trim().slice(0, 80);
  if (!title) redirect("/dashboard/links?error=Judul collection wajib diisi");
  const { error } = await supabase.from("link_collections").update({ title }).eq("id", String(formData.get("id") ?? "")).eq("linktree_id", linktree.id);
  if (error) redirect(`/dashboard/links?error=${encodeURIComponent(friendlyError(error))}`);
  revalidatePath("/dashboard/links");
}

export async function deleteCollection(formData: FormData) {
  const { supabase, linktree } = await authenticatedClient();
  await supabase.from("link_collections").delete().eq("id", String(formData.get("id") ?? "")).eq("linktree_id", linktree.id);
  revalidatePath("/dashboard/links");
}

export async function addPresetLink(formData: FormData) {
  const { supabase, user, linktree } = await authenticatedClient();
  const platform = String(formData.get("platform") ?? "link");
  const collectionId = String(formData.get("collection_id") ?? "");
  const [{ data: collection }, { data: existing }, { count }] = await Promise.all([
    supabase.from("link_collections").select("id").eq("id", collectionId).eq("linktree_id", linktree.id).single(),
    supabase.from("links").select("id").eq("collection_id", collectionId).eq("platform", platform).maybeSingle(),
    supabase.from("links").select("id", { count: "exact", head: true }).eq("linktree_id", linktree.id),
  ]);
  if (!collection) redirect("/dashboard/links?error=Collection tidak valid");
  if (existing) redirect(`/dashboard/links?error=${encodeURIComponent(`${platform} sudah ditambahkan di collection ini`)}`);
  const presets: Record<string, { title: string; url: string }> = {
    instagram: { title: "Instagram", url: "https://instagram.com/" },
    tiktok: { title: "TikTok", url: "https://tiktok.com/" },
    youtube: { title: "YouTube", url: "https://youtube.com/" },
    whatsapp: { title: "WhatsApp", url: "https://wa.me/628123456789" },
    email: { title: "Email", url: "mailto:username@gmail.com" },
    website: { title: "Website", url: "https://example.com/" },
    ...Object.fromEntries(Object.entries(commercePlatforms).map(([key, item]) => [key, { title: item.label, url: item.url }])),
  };
  const preset = presets[platform] ?? presets.website;
  const { error } = await supabase.from("links").insert({ user_id: user.id, linktree_id: linktree.id, collection_id: collectionId, platform, title: preset.title, url: preset.url, position: count ?? 0 });
  if (error) redirect(`/dashboard/links?error=${encodeURIComponent(friendlyError(error))}`);
  revalidatePath("/dashboard/links");
}

export async function reorderCollections(ids: string[]) {
  const { supabase, linktree } = await authenticatedClient();
  await Promise.all(ids.map((id, position) => supabase.from("link_collections").update({ position }).eq("id", id).eq("linktree_id", linktree.id)));
  revalidatePath("/dashboard/links");
}
export async function addShopCollection() {
  const { supabase, user, linktree } = await authenticatedClient();
  const { count } = await supabase.from("shop_collections").select("id", { count: "exact", head: true }).eq("linktree_id", linktree.id);
  const { error } = await supabase.from("shop_collections").insert({ user_id: user.id, linktree_id: linktree.id, title: "My Products", position: count ?? 0 });
  if (error) redirect(`/dashboard/shops?error=${encodeURIComponent(friendlyError(error))}`);
  revalidatePath("/dashboard/shops");
  redirect("/dashboard/shops");
}

export async function updateShopCollection(formData: FormData) {
  const { supabase, linktree } = await authenticatedClient();
  const title = String(formData.get("title") ?? "").trim().slice(0, 80);
  if (!title) redirect("/dashboard/shops?error=Judul collection wajib diisi");
  const { error } = await supabase.from("shop_collections").update({ title }).eq("id", String(formData.get("id") ?? "")).eq("linktree_id", linktree.id);
  if (error) redirect(`/dashboard/shops?error=${encodeURIComponent(friendlyError(error))}`);
  revalidatePath("/dashboard/shops");
}

export async function deleteShopCollection(formData: FormData) {
  const { supabase, linktree } = await authenticatedClient();
  await supabase.from("shop_collections").delete().eq("id", String(formData.get("id") ?? "")).eq("linktree_id", linktree.id);
  revalidatePath("/dashboard/shops");
}

// Tanggal dari <input type="date"> dihitung dalam WIB: tayang mulai 00:00, berakhir setelah 23:59 hari itu.
function wibDate(value: FormDataEntryValue | null, endOfDay = false) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00+07:00`);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString();
}

function productFields(formData: FormData) {
  const url = validUrl(formData.get("url"));
  const chosen = String(formData.get("platform") ?? "auto");
  const platform = chosen === "auto" ? detectPlatform(url) : chosen === "website" || isCommercePlatform(chosen) ? chosen : "website";
  const startsAt = wibDate(formData.get("starts_at"));
  const endsAt = wibDate(formData.get("ends_at"), true);
  if (startsAt && endsAt && endsAt <= startsAt) redirect("/dashboard/shops?error=Tanggal berakhir harus setelah tanggal tayang");
  const title = String(formData.get("title") ?? "").trim().slice(0, 100);
  if (!title) redirect("/dashboard/shops?error=Nama produk wajib diisi");
  return { platform, title, url, price: priceDigits(String(formData.get("price") ?? "")), compare_price: priceDigits(String(formData.get("compare_price") ?? "")), is_featured: formData.get("is_featured") === "on", starts_at: startsAt, ends_at: endsAt };
}

async function ownedShopCollection(supabase: Awaited<ReturnType<typeof createClient>>, linktreeId: string, value: FormDataEntryValue | null) {
  const id = String(value ?? "");
  const { data } = isUuid(id) ? await supabase.from("shop_collections").select("id").eq("id", id).eq("linktree_id", linktreeId).maybeSingle() : { data: null };
  if (!data) redirect("/dashboard/shops?error=Kategori tidak valid");
  return data.id;
}

export async function addProduct(formData: FormData) {
  const { supabase, user, linktree } = await authenticatedClient();
  const collectionId = await ownedShopCollection(supabase, linktree.id, formData.get("collection_id"));
  const fields = productFields(formData);
  const image = await uploadProductImage(supabase, user.id, formData.get("image"));
  const { count } = await supabase.from("products").select("id", { count: "exact", head: true }).eq("collection_id", collectionId);
  const { error } = await supabase.from("products").insert({ user_id: user.id, linktree_id: linktree.id, collection_id: collectionId, ...fields, image_path: image?.path ?? null, image_url: image?.url ?? null, position: count ?? 0 });
  if (error) {
    if (image) await supabase.storage.from("product-images").remove([image.path]);
    redirect(`/dashboard/shops?error=${encodeURIComponent(friendlyError(error))}`);
  }
  revalidatePath("/dashboard/shops");
  redirect("/dashboard/shops?message=Produk ditambahkan");
}

export async function updateProduct(formData: FormData) {
  const { supabase, user, linktree } = await authenticatedClient();
  const id = String(formData.get("id") ?? "");
  const { data: current } = isUuid(id) ? await supabase.from("products").select("image_path").eq("id", id).eq("linktree_id", linktree.id).maybeSingle() : { data: null };
  if (!current) redirect("/dashboard/shops?error=Produk tidak ditemukan");
  const collectionId = await ownedShopCollection(supabase, linktree.id, formData.get("collection_id"));
  const fields = productFields(formData);
  const image = await uploadProductImage(supabase, user.id, formData.get("image"));
  const changes: Record<string, string | boolean | null> = { ...fields, collection_id: collectionId, is_active: formData.get("is_active") === "on" };
  if (image) { changes.image_path = image.path; changes.image_url = image.url; }
  const { error } = await supabase.from("products").update(changes).eq("id", id).eq("linktree_id", linktree.id);
  if (error) {
    if (image) await supabase.storage.from("product-images").remove([image.path]);
    redirect(`/dashboard/shops?error=${encodeURIComponent(friendlyError(error))}`);
  }
  if (image && current.image_path) await supabase.storage.from("product-images").remove([current.image_path]);
  revalidatePath("/dashboard/shops");
  redirect("/dashboard/shops?message=Produk disimpan");
}

export async function setProductActive(id: string, active: boolean) {
  const { supabase, linktree } = await authenticatedClient();
  if (!isUuid(id)) return;
  await supabase.from("products").update({ is_active: active }).eq("id", id).eq("linktree_id", linktree.id);
  revalidatePath("/dashboard/shops");
}

// Naik/turun satu langkah di dalam kategorinya; posisi dinomori ulang supaya tidak ada yang kembar.
export async function moveProduct(id: string, direction: -1 | 1) {
  const { supabase, linktree } = await authenticatedClient();
  if (!isUuid(id)) return;
  const { data: product } = await supabase.from("products").select("collection_id").eq("id", id).eq("linktree_id", linktree.id).maybeSingle();
  if (!product) return;
  const { data: siblings } = await supabase.from("products").select("id").eq("collection_id", product.collection_id).eq("linktree_id", linktree.id).order("position").order("created_at");
  const order = (siblings ?? []).map((item) => item.id);
  const from = order.indexOf(id); const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to], order[from]];
  await Promise.all(order.map((itemId, position) => supabase.from("products").update({ position }).eq("id", itemId).eq("linktree_id", linktree.id)));
  revalidatePath("/dashboard/shops");
}

export async function deleteProduct(formData: FormData) {
  const { supabase, linktree } = await authenticatedClient();
  const id = String(formData.get("id") ?? "");
  const { data: product } = await supabase.from("products").select("image_path").eq("id", id).eq("linktree_id", linktree.id).single();
  await supabase.from("products").delete().eq("id", id).eq("linktree_id", linktree.id);
  if (product?.image_path) await supabase.storage.from("product-images").remove([product.image_path]);
  revalidatePath("/dashboard/shops");
}

export async function reorderShopCollections(ids: string[]) {
  const { supabase, linktree } = await authenticatedClient();
  await Promise.all(ids.map((id, position) => supabase.from("shop_collections").update({ position }).eq("id", id).eq("linktree_id", linktree.id)));
  revalidatePath("/dashboard/shops");
}
export async function saveCustomDesign(formData: FormData) {
  const { supabase, user, linktree } = await authenticatedClient();
  const allowed = {
    title_style: ["normal", "uppercase", "italic", "serif"],
    wallpaper_style: ["solid", "gradient", "soft"],
    button_style: ["solid", "glass", "outline"],
    button_roundness: ["square", "soft", "rounded", "pill"],
    page_font: ["geist", "inter", "poppins", "playfair", "space", "dm-sans", "lora", "merriweather", "nunito", "montserrat", "bebas-neue", "caveat"],
  } as const;
  const values = Object.fromEntries(Object.keys(allowed).map((key) => [key, String(formData.get(key) ?? "")]));
  for (const [key, options] of Object.entries(allowed)) if (!(options as readonly string[]).includes(values[key])) redirect("/dashboard/design/customize?error=Pilihan desain tidak valid");
  const { data: current } = await supabase.from("linktrees").select("slug").eq("id", linktree.id).eq("owner_id", user.id).single();
  const changes: Record<string, string> = {
    title_style: values.title_style,
    title_color: validColor(formData.get("title_color")),
    wallpaper_style: values.wallpaper_style,
    background_color: validColor(formData.get("background_color")),
    button_style: values.button_style,
    button_roundness: values.button_roundness,
    button_color: validColor(formData.get("button_color")),
    button_text_color: validColor(formData.get("button_text_color")),
    page_font: values.page_font,
    text_color: validColor(formData.get("text_color")),
    custom_footer: String(formData.get("custom_footer") ?? "").trim().slice(0, 120),
    theme_preset: "custom",
  };
  const title = String(formData.get("title") ?? "").trim().slice(0, 60);
  if (!title) redirect("/dashboard/design/customize?error=Title wajib diisi");
  const [{ error }, { error: headerError }] = await Promise.all([
    supabase.from("linktrees").update(changes).eq("id", linktree.id).eq("owner_id", user.id),
    supabase.from("linktree_headers").upsert({ linktree_id: linktree.id, title, bio: String(formData.get("bio") ?? "").trim().slice(0, 160) }),
  ]);
  if (error || headerError) redirect(`/dashboard/design/customize?error=${encodeURIComponent(friendlyError((error || headerError)!))}`);
  revalidatePath("/dashboard", "layout");
  if (current?.slug) revalidatePath(`/${current.slug}`);
  redirect("/dashboard/design/customize?message=Design disimpan");
}
export async function saveShareSettings(formData: FormData) {
  const { supabase, user, linktree } = await authenticatedClient();
  const { data: profile } = await supabase.from("linktrees").select("slug").eq("id", linktree.id).eq("owner_id", user.id).single();
  const { error } = await supabase.from("linktrees").update({
    seo_title: String(formData.get("seo_title") ?? "").trim().slice(0, 70),
    seo_description: String(formData.get("seo_description") ?? "").trim().slice(0, 160),
    share_image_color: validColor(formData.get("share_image_color")),
  }).eq("id", linktree.id).eq("owner_id", user.id);
  if (error) redirect(`/dashboard/share?error=${encodeURIComponent(friendlyError(error))}`);
  if (profile?.slug) revalidatePath(`/${profile.slug}`);
  redirect("/dashboard/share?message=Share settings disimpan");
}
export async function switchLinktree(formData: FormData) {
  const { user, supabase } = await getDashboardContext();
  const id = String(formData.get("linktree_id") ?? "");
  const { data } = await supabase.from("linktrees").select("id").eq("id", id).eq("owner_id", user.id).single();
  if (!data) redirect("/dashboard/links?error=Linktree tidak valid");
  (await cookies()).set("active_linktree_id", id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 31536000 });
  redirect("/dashboard/links");
}

export async function createLinktree(formData: FormData) {
  const { user, supabase, linktrees } = await getDashboardContext();
  if (linktrees.length >= 3) redirect("/dashboard/new?error=Maksimal 3 Linktree per akun");
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) redirect("/dashboard/new?error=Slug harus 3-40 karakter");
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  const bio = String(formData.get("bio") ?? "").trim().slice(0, 160);
  const { data, error } = await supabase.from("linktrees").insert({ owner_id: user.id, name, bio, slug }).select("id").single();
  if (error) redirect(`/dashboard/new?error=${encodeURIComponent(friendlyError(error))}`);
  (await cookies()).set("active_linktree_id", data.id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 31536000 });
  redirect("/dashboard/links");
}
function accountError(message: string): never {
  redirect(`/dashboard/account?error=${encodeURIComponent(message)}`);
}

async function requireSensitiveAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.nextLevel === "aal2" && data.currentLevel !== "aal2") redirect("/login/mfa?next=/dashboard/account");
}

export async function savePrivacy(formData: FormData) {
  const { supabase, user } = await authenticatedClient();
  const { error } = await supabase.from("profiles").update({ allow_data_sharing: formData.get("allow_data_sharing") === "true" }).eq("id", user.id);
  if (error) accountError(friendlyError(error));
  revalidatePath("/dashboard/account");
  redirect("/dashboard/account?message=Privacy settings disimpan");
}

export async function changePassword(formData: FormData) {
  const { supabase } = await authenticatedClient();
  await requireSensitiveAuth(supabase);
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("confirmation") ?? "");
  if (password.length < 8) accountError("Password minimal 8 karakter");
  if (password !== confirmation) accountError("Konfirmasi password tidak sama");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) accountError(friendlyError(error));
  redirect("/dashboard/account?message=Password berhasil diperbarui");
}

export async function trustCurrentDevice() {
  const { supabase, user } = await authenticatedClient();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return { error: "Verifikasi MFA diperlukan sebelum mempercayai perangkat" };
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const { error } = await supabase.from("trusted_devices").insert({ user_id: user.id, token_hash: await hashTrustedToken(token), label: "Browser saat ini", expires_at: expiresAt.toISOString() });
  if (error) return { error: friendlyError(error) };
  (await cookies()).set("trusted_device", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
  revalidatePath("/dashboard/account");
  return { error: null };
}

export async function removeTrustedDevice(formData: FormData) {
  const { supabase, user } = await authenticatedClient();
  const id = String(formData.get("device_id") ?? "");
  const { error } = await supabase.from("trusted_devices").delete().eq("id", id).eq("user_id", user.id);
  if (error) accountError(friendlyError(error));
  (await cookies()).delete("trusted_device");
  revalidatePath("/dashboard/account");
}

export async function deleteLinktreeAccount(formData: FormData) {
  const { supabase, user, linktree, linktrees } = await authenticatedClient();
  await requireSensitiveAuth(supabase);
  if (linktrees.length <= 1) accountError("Linktree terakhir tidak dapat dihapus. Hapus akun jika ingin menghapus semuanya.");
  if (String(formData.get("confirmation") ?? "") !== linktree.slug) accountError("Ketik slug Linktree dengan benar untuk menghapus");
  const { error } = await supabase.from("linktrees").delete().eq("id", linktree.id).eq("owner_id", user.id);
  if (error) accountError(friendlyError(error));
  (await cookies()).delete("active_linktree_id");
  redirect("/dashboard/links");
}

export async function deleteAccount(formData: FormData) {
  const { user, supabase } = await authenticatedClient();
  await requireSensitiveAuth(supabase);
  if (String(formData.get("confirmation") ?? "") !== "DELETE") accountError("Ketik DELETE untuk menghapus akun");
  const { createAdminClient } = await import("@/lib/supabase/admin");
  const admin = createAdminClient();
  if (!admin) accountError("SUPABASE_SERVICE_ROLE_KEY belum dipasang di server");
  for (const bucket of ["profile-images", "product-images"]) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error: listError } = await admin.storage.from(bucket).list(user.id, { limit: 1000, offset });
      if (listError) accountError("Gagal menghapus file. Coba lagi.");
      if (!data?.length) break;
      const { error: removeError } = await admin.storage.from(bucket).remove(data.map((item) => `${user.id}/${item.name}`));
      if (removeError) accountError("Gagal menghapus file. Coba lagi.");
      if (data.length < 1000) break;
    }
  }
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) accountError(friendlyError(error));
  const cookieStore = await cookies();
  cookieStore.getAll().forEach((cookie) => cookieStore.delete(cookie.name));
  redirect("/");
}





