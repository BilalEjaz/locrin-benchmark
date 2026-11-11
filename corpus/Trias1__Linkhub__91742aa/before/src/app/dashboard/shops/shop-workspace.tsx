"use client";

import { useState, useTransition } from "react";
import { PlatformIcon } from "@/components/platform-icon";
import { ShareProfileButton } from "@/components/share-profile-button";
import { formatRupiah } from "@/lib/rupiah";
import { RupiahInput } from "./rupiah-input";
import { commercePlatforms } from "@/lib/commerce-platforms";
import type { Locale } from "@/lib/i18n";
import { addProduct, addShopCollection, deleteProduct, deleteShopCollection, reorderShopCollections, updateProduct, updateShopCollection } from "../actions";

type ShopCollection = { id: string; title: string; position: number };
type Product = { id: string; collection_id: string; platform: string; title: string; url: string; price: string; image_url: string | null; is_active: boolean };
type LinkCollection = { id: string; title: string };
type LinkItem = { id: string; collection_id: string | null; title: string; platform: string | null; is_active: boolean };
type Profile = { name: string; slug: string | null; bio: string; avatar_url: string | null; background_color: string; text_color: string; button_color: string };

export function ShopWorkspace({ initialCollections, products, linkCollections, links, profile,locale }: { locale:Locale; initialCollections: ShopCollection[]; products: Product[]; linkCollections: LinkCollection[]; links: LinkItem[]; profile: Profile }) {
  const en=locale==="en";
  const [collections, setCollections] = useState(initialCollections);
  const [preview, setPreview] = useState<"links" | "shop">("shop");
  const [draggedId, setDraggedId] = useState<string | null>(null);
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
    startTransition(() => reorderShopCollections(next.map((item) => item.id)));
  }

  return <div className="links-workspace">
    <section className="links-builder">
      <div className="builder-heading"><div><p className="section-label">{en?"My Linktree":"Linktree Saya"}</p><h1>{en?"Shop":"Toko"}</h1></div>{collections.length?<form action={addShopCollection}><button>{en?"+ Add collection":"+ Tambah koleksi"}</button></form>:null}</div>
      {collections.map((collection) => { const collectionProducts = products.filter((item) => item.collection_id === collection.id); return <article className={`collection-card${draggedId === collection.id ? " dragging" : ""}`} draggable onDragStart={() => setDraggedId(collection.id)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(collection.id)} key={collection.id}>
        <div className="collection-header"><span className="drag-handle">⋮⋮</span><form action={updateShopCollection} className="collection-title"><input type="hidden" name="id" value={collection.id} /><input name="title" defaultValue={collection.title} aria-label="Shop collection title" /><button className="secondary">{en?"Save":"Simpan"}</button></form><form action={deleteShopCollection} onSubmit={(event)=>{if(!confirm("Hapus shop collection ini?"))event.preventDefault();}}><input type="hidden" name="id" value={collection.id} /><button className="icon-danger" aria-label="Delete shop collection">×</button></form></div>
        <form action={addProduct} className="product-add"><input type="hidden" name="collection_id" value={collection.id} /><label className="field-label"><span>{en?"Platform":"Platform"}</span><select name="platform" defaultValue="website"><option value="website">Website / Other</option>{Object.entries(commercePlatforms).map(([value,item]) => <option value={value} key={value}>{item.label}</option>)}</select></label><label className="field-label"><span>{en?"Product name":"Nama produk"}</span><input name="title" required maxLength={100} placeholder={en?"Product name":"Nama produk"} /></label><label className="field-label"><span>{en?"Product URL":"URL produk"}</span><input name="url" required type="url" placeholder="https://..." /></label><RupiahInput /><label className="image-input">Product image<input name="image" type="file" accept="image/jpeg,image/png,image/webp" required /></label><button>+ Add product</button></form>
        <div className="collection-links">{collectionProducts.map((item) => <form action={updateProduct} className="product-editor" key={item.id}>{item.image_url ? <span className="product-image" style={{ backgroundImage: `url(${item.image_url})` }} /> : <span className="product-icon"><PlatformIcon platform={item.platform} /></span>}<input type="hidden" name="id" value={item.id} /><label className="field-label"><span>{en?"Platform":"Platform"}</span><select name="platform" defaultValue={item.platform}><option value="website">Website / Other</option>{Object.entries(commercePlatforms).map(([value,platform]) => <option value={value} key={value}>{platform.label}</option>)}</select></label><label className="field-label"><span>{en?"Product name":"Nama produk"}</span><input name="title" required defaultValue={item.title} /></label><label className="field-label"><span>{en?"Product URL":"URL produk"}</span><input name="url" type="url" required defaultValue={item.url} /></label><RupiahInput defaultValue={item.price} /><label className="replace-image">Ganti gambar<input name="image" type="file" accept="image/jpeg,image/png,image/webp" /></label><label className="check status-field"><span>Status</span><span><input name="is_active" type="checkbox" defaultChecked={item.is_active} /> {en?"Active":"Aktif"}</span></label><button>{en?"Save":"Simpan"}</button><button className="danger" formAction={deleteProduct} onClick={(event)=>{if(!confirm("Hapus produk ini?"))event.preventDefault();}}>×</button></form>)}{!collectionProducts.length ? <p className="empty small-empty">{en?"This collection has no linked products yet.":"Koleksi ini belum memiliki produk tertaut."}</p> : null}</div>
      </article>; })}
      {!collections.length ? <div className="panel empty-collection"><h2>{en?"No collection yet":"Belum punya koleksi"}</h2><p>{en?"Create a collection to start adding linked products.":"Buat koleksi untuk mulai menambahkan produk tertaut."}</p><form action={addShopCollection}><button>{en?"+ Create a new collection":"+ Buat koleksi baru"}</button></form></div> : null}
      {isPending ? <p className="saving-order">{en?"Saving order…":"Menyimpan urutan…"}</p> : null}
    </section>
    <aside className="preview-column">
      <ShareProfileButton slug={profile.slug} name={profile.name} />
      <div className="linktree-preview" style={{ background: profile.background_color, color: profile.text_color }}>
        <div className="preview-profile">{profile.avatar_url ? <span className="preview-photo" role="img" aria-label={`${profile.name} profile`} style={{ backgroundImage: `url(${profile.avatar_url})` }} /> : <div className="preview-avatar">{profile.name.slice(0, 1).toUpperCase()}</div>}<h2>{profile.name}</h2><p>{profile.bio}</p></div>
        <div className="preview-switch"><button className={preview === "links" ? "active" : ""} onClick={() => setPreview("links")}>{en?"Links":"Tautan"}</button><button className={preview === "shop" ? "active" : ""} onClick={() => setPreview("shop")}>{en?"Shop":"Toko"}</button></div>
        {preview === "shop" ? <div className="preview-products">{collections.map((collection) => { const visible = products.filter((item) => item.collection_id === collection.id && item.is_active); return visible.length ? <details className="shop-preview-group" open key={collection.id}><summary>{collection.title}</summary>{visible.map((item) => <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ background: profile.button_color }} key={item.id}>{item.image_url ? <span className="product-thumb product-image" style={{ backgroundImage: `url(${item.image_url})` }} /> : <span className="product-thumb"><PlatformIcon platform={item.platform} /></span>}<span><strong>{item.title}</strong>{item.price ? <small>{formatRupiah(item.price)}</small> : null}</span><b>↗</b></a>)}</details> : null; })}{!products.some((item) => item.is_active) ? <div className="preview-shop"><strong>{en?"No products yet":"Belum ada produk"}</strong><p>{en?"Linked products will appear here.":"Produk tertaut akan muncul di sini."}</p></div> : null}</div> : <div className="preview-collections">{linkCollections.map((collection) => { const visible = links.filter((item) => item.collection_id === collection.id && item.is_active); return visible.length ? <section key={collection.id}><h3>{collection.title}</h3>{visible.map((item) => <span style={{ background: profile.button_color }} key={item.id}><i><PlatformIcon platform={item.platform} />{item.title}</i><b>↗</b></span>)}</section> : null; })}</div>}
        <footer>LinkHub by Trias</footer>
      </div>
    </aside>
  </div>;
}



