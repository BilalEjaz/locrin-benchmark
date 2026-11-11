import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { fetchProducts, productStatus } from "@/lib/products";
import { PublicProfileContent } from "./public-profile-content";
import { getLocale } from "@/lib/i18n-server";

export async function generateMetadata({ params }: { params:Promise<{ slug:string }> }):Promise<Metadata> {
  const { slug }=await params; const supabase=await createClient(); const locale=await getLocale();
  const { data:profile }=await supabase.from("linktrees").select("id,name,bio,seo_title,seo_description").eq("slug",slug).single();
  if(!profile) return {};
  const { data:header }=await supabase.from("linktree_headers").select("title,bio").eq("linktree_id",profile.id).maybeSingle();
  const publicTitle=header?.title||profile.name; const publicBio=header?.bio??profile.bio;
  const title=profile.seo_title||publicTitle; const description=profile.seo_description||publicBio||(locale==="en"?`Visit ${publicTitle} on LinkHub`:`Kunjungi Linktree ${publicTitle}`);
  return {title,description,openGraph:{title,description,type:"website"},twitter:{card:"summary_large_image",title,description}};
}

export default async function PublicProfile({ params }: { params:Promise<{ slug:string }> }) {
  const { slug }=await params; const supabase=await createClient(); const locale=await getLocale();
  const { data:profile }=await supabase.from("linktrees").select("id,name,bio,avatar_url,background_color,text_color,button_color,title_style,title_color,wallpaper_style,button_style,button_roundness,button_text_color,page_font,custom_footer").eq("slug",slug).single();
  if(!profile) notFound();
  const [{data:header},{data:linkCollections},{data:links},{data:shopCollections},products]=await Promise.all([
    supabase.from("linktree_headers").select("title,bio").eq("linktree_id",profile.id).maybeSingle(),
    supabase.from("link_collections").select("id,title").eq("linktree_id",profile.id).order("position"),
    supabase.from("links").select("id,collection_id,title,platform").eq("linktree_id",profile.id).eq("is_active",true).order("position"),
    supabase.from("shop_collections").select("id,title").eq("linktree_id",profile.id).order("position"),
    fetchProducts(supabase,profile.id,true),
  ]);
  // Pemilik bisa membaca produk terjadwal lewat RLS, jadi saring juga di sini.
  const now=Date.now(); const visible=products.filter((item)=>productStatus(item,now)==="live");
  const background=profile.wallpaper_style==="gradient"?`linear-gradient(135deg, ${profile.background_color}, ${profile.button_color})`:profile.wallpaper_style==="soft"?`radial-gradient(circle at top, ${profile.button_color}, ${profile.background_color} 58%)`:profile.background_color;
  const style={background,"--profile-bg":profile.background_color,"--profile-text":profile.text_color,"--profile-button":profile.button_color,"--profile-button-text":profile.button_text_color,"--profile-title":profile.title_color} as React.CSSProperties;
  return <main className={`lh-profile font-${profile.page_font}`} style={style}><PublicProfileContent locale={locale} profile={{id:profile.id,name:header?.title||profile.name,bio:header?.bio??profile.bio,avatar_url:profile.avatar_url,title_style:profile.title_style,button_style:profile.button_style,button_roundness:profile.button_roundness,custom_footer:profile.custom_footer}} linkCollections={linkCollections??[]} links={links??[]} shopCollections={shopCollections??[]} products={visible.map(({id,collection_id,platform,title,price,image_url,compare_price,is_featured,ends_at})=>({id,collection_id,platform,title,price,image_url,compare_price,is_featured,ends_at}))}/></main>;
}
