"use client";

import { useState, useTransition } from "react";
import { PlatformIcon } from "@/components/platform-icon";
import { ShareProfileButton } from "@/components/share-profile-button";
import { commercePlatforms } from "@/lib/commerce-platforms";
import type { Locale } from "@/lib/i18n";
import { addCollection, addLink, addPresetLink, deleteCollection, deleteLink, reorderCollections, updateCollection, updateLink } from "../actions";

type Collection = { id: string; title: string; position: number };
type LinkItem = { id: string; collection_id: string | null; title: string; url: string; platform: string | null; is_active: boolean };
type Profile = { name: string; slug: string | null; bio: string; avatar_url: string | null; background_color: string; text_color: string; button_color: string };

const presets = ["instagram", "tiktok", "youtube", "whatsapp", "email", "website", ...Object.keys(commercePlatforms)];
const platformLabel = (platform: string) => commercePlatforms[platform as keyof typeof commercePlatforms]?.label ?? platform;

export function LinksWorkspace({ initialCollections, links, profile,locale }: { locale:Locale; initialCollections: Collection[]; links: LinkItem[]; profile: Profile }) {
  const en=locale==="en";
  const [collections, setCollections] = useState(initialCollections);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<"links" | "shop">("links");
  const [isPending, startTransition] = useTransition();

  function dropOn(targetId: string) {
    if (!draggedId || draggedId === targetId) return;
    const next = [...collections];
    const from = next.findIndex((item) => item.id === draggedId);
    const to = next.findIndex((item) => item.id === targetId);
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    setCollections(next);
    setDraggedId(null);
    startTransition(() => reorderCollections(next.map((item) => item.id)));
  }

  return (
    <div className="links-workspace">
      <section className="links-builder">
        <div className="builder-heading"><div><p className="section-label">{en?"My Linktree":"Linktree Saya"}</p><h1>{en?"Links":"Tautan"}</h1></div>{collections.length?<form action={addCollection}><button>{en?"+ Add collection":"+ Tambah koleksi"}</button></form>:null}</div>
        {collections.map((collection) => {
          const collectionLinks = links.filter((item) => item.collection_id === collection.id);
          const usedPlatforms = new Set(collectionLinks.map((item) => item.platform).filter(Boolean));
          const availablePlatforms = presets.filter((platform) => !usedPlatforms.has(platform));
          return <article className={`collection-card${draggedId === collection.id ? " dragging" : ""}`} draggable onDragStart={() => setDraggedId(collection.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(collection.id)} key={collection.id}>
            <div className="collection-header"><span className="drag-handle" title={en?"Drag collection":"Geser koleksi"}>⋮⋮</span><form action={updateCollection} className="collection-title"><input type="hidden" name="id" value={collection.id} /><input name="title" defaultValue={collection.title} aria-label={en?"Collection title":"Judul koleksi"} /><button className="secondary">{en?"Save":"Simpan"}</button></form><form action={deleteCollection} onSubmit={(event)=>{if(!confirm("Hapus collection ini?"))event.preventDefault();}}><input type="hidden" name="id" value={collection.id} /><button className="icon-danger" aria-label={en?"Delete collection":"Hapus koleksi"}>×</button></form></div>
            <form action={addPresetLink} className="preset-actions"><input type="hidden" name="collection_id" value={collection.id} /><label><span>{en?"Add platform":"Tambah platform"}</span><select name="platform" defaultValue={availablePlatforms[0]} disabled={!availablePlatforms.length}>{availablePlatforms.length ? availablePlatforms.map((platform) => <option value={platform} key={platform}>{platformLabel(platform)}</option>) : <option>{en?"All platforms have been added":"Semua platform sudah ditambahkan"}</option>}</select></label><button className="preset-button" disabled={!availablePlatforms.length}>{en?"+ Add platform":"+ Tambah platform"}</button></form>
            <form action={addLink} className="add-link collection-add"><input type="hidden" name="collection_id" value={collection.id} /><input name="title" required maxLength={80} placeholder={en?"Title":"Judul"} /><input name="url" required type="url" placeholder="https://..." /><button>{en?"Add":"Tambah"}</button></form>
            <div className="collection-links">{collectionLinks.map((item) => <form action={updateLink} className="compact-link-editor" key={item.id}><span className="link-platform"><PlatformIcon platform={item.platform} /></span><input type="hidden" name="id" value={item.id} /><input name="title" required defaultValue={item.title} /><input name="url" type="url" required defaultValue={item.url} /><label className="check"><input name="is_active" type="checkbox" defaultChecked={item.is_active} /> {en?"On":"Aktif"}</label><button>{en?"Save":"Simpan"}</button><button className="danger" formAction={deleteLink} onClick={(event)=>{if(!confirm("Hapus link ini?"))event.preventDefault();}}>×</button></form>)}{!collectionLinks.length ? <p className="empty small-empty">{en?"Add Instagram, TikTok, YouTube, or another link.":"Tambahkan Instagram, TikTok, YouTube, atau tautan lain."}</p> : null}</div>
          </article>;
        })}
        {!collections.length ? <div className="panel empty-collection"><h2>{en?"Start your first Linktree":"Mulai Linktree pertamamu"}</h2><p>{en?"1. Create a collection · 2. Add links · 3. Design and share.":"1. Buat koleksi · 2. Tambahkan tautan · 3. Atur desain dan bagikan."}</p><form action={addCollection}><button>{en?"+ Add collection":"+ Tambah koleksi"}</button></form></div> : null}
        {isPending ? <p className="saving-order">{en?"Saving order…":"Menyimpan urutan…"}</p> : null}
      </section>
      <aside className="preview-column">
        <ShareProfileButton slug={profile.slug} name={profile.name} />
        <div className="linktree-preview" style={{ background: profile.background_color, color: profile.text_color }}>
          <div className="preview-profile">{profile.avatar_url ? <span className="preview-photo" role="img" aria-label={`${profile.name} profile`} style={{ backgroundImage: `url(${profile.avatar_url})` }} /> : <div className="preview-avatar">{profile.name.slice(0, 1).toUpperCase()}</div>}<h2>{profile.name}</h2><p>{profile.bio}</p></div>
          <div className="preview-switch"><button className={preview === "links" ? "active" : ""} onClick={() => setPreview("links")}>{en?"Links":"Tautan"}</button><button className={preview === "shop" ? "active" : ""} onClick={() => setPreview("shop")}>{en?"Shop":"Toko"}</button></div>
          {preview === "links" ? <div className="preview-collections">{collections.map((collection) => { const visible = links.filter((item) => item.collection_id === collection.id && item.is_active); return visible.length ? <section key={collection.id}><h3>{collection.title}</h3>{visible.map((item) => <span style={{ background: profile.button_color }} key={item.id}><i><PlatformIcon platform={item.platform} />{item.title}</i><b>↗</b></span>)}</section> : null; })}</div> : <div className="preview-shop"><strong>{en?"Shop is not active":"Toko belum aktif"}</strong><p>{en?"Products will appear here.":"Produk akan muncul di sini."}</p></div>}
          <footer>LinkHub by Trias</footer>
        </div>
      </aside>
    </div>
  );
}



