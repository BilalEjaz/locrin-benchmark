import type { SupabaseClient } from "@supabase/supabase-js";

export type Product = {
  id: string; collection_id: string; platform: string; title: string; url: string; price: string; image_url: string | null; is_active: boolean;
  compare_price: string; is_featured: boolean; starts_at: string | null; ends_at: string | null;
};

const legacyColumns = "id,collection_id,platform,title,url,price,image_url,is_active";
const columns = `${legacyColumns},compare_price,is_featured,starts_at,ends_at`;

// Kolom promo/jadwal datang dari SQL 018. Kalau belum dijalankan, pakai kolom lama supaya halaman tetap jalan.
export async function fetchProducts(supabase: SupabaseClient, linktreeId: string, onlyActive = false) {
  const run = (select: string) => { const query = supabase.from("products").select(select).eq("linktree_id", linktreeId); return (onlyActive ? query.eq("is_active", true) : query).order("position").order("created_at"); };
  let { data, error } = await run(columns);
  if (error) ({ data, error } = await run(legacyColumns));
  return ((data ?? []) as unknown as Partial<Product>[]).map((item) => ({ compare_price: "", is_featured: false, starts_at: null, ends_at: null, ...item }) as Product);
}

export type ProductStatus = "live" | "scheduled" | "ended" | "hidden";
export function productStatus(product: Pick<Product, "is_active" | "starts_at" | "ends_at">, now = Date.now()): ProductStatus {
  if (!product.is_active) return "hidden";
  if (product.starts_at && Date.parse(product.starts_at) > now) return "scheduled";
  if (product.ends_at && Date.parse(product.ends_at) <= now) return "ended";
  return "live";
}

const wib = (locale: string) => new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
// ends_at disimpan sebagai 00:00 WIB hari berikutnya, jadi tanggal yang ditampilkan dikurangi 1 ms.
export const formatEndDate = (value: string, locale = "id") => wib(locale).format(new Date(Date.parse(value) - 1));
export const formatStartDate = (value: string, locale = "id") => wib(locale).format(new Date(value));
// Nilai untuk <input type="date"> dalam WIB.
export function dateInputValue(value: string | null, isEnd = false) {
  if (!value) return "";
  const date = new Date(Date.parse(value) - (isEnd ? 1 : 0));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
}
