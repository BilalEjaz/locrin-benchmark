"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logout } from "@/app/auth/actions";
import { DashboardIcon } from "@/components/dashboard-icon";
import { LanguageSwitcher } from "@/components/language-switcher";
import { type Locale, withLocale, withoutLocale } from "@/lib/i18n";
import { switchLinktree } from "./actions";

type Linktree={id:string;name:string;slug:string|null};
const items=[{href:"/dashboard/links",id:"Tautan",en:"Links",icon:"links"},{href:"/dashboard/shops",id:"Toko",en:"Shops",icon:"shop"},{href:"/dashboard/design",id:"Desain",en:"Design",icon:"design"},{href:"/dashboard/insights",id:"Insight",en:"Insights",icon:"insights"}] as const;

export function DashboardSidebar({name,avatarUrl,email,slug,isAdmin,activeId,linktrees,locale}:{name:string;avatarUrl?:string|null;email:string;slug?:string|null;isAdmin:boolean;activeId:string;linktrees:Linktree[];locale:Locale}){
  const pathname=withoutLocale(usePathname());const [collapsed,setCollapsed]=useState(false);const [mobile,setMobile]=useState(false);const accountRef=useRef<HTMLDetailsElement>(null);const en=locale==="en";
  useEffect(()=>{const media=window.matchMedia("(max-width:1100px)");const sync=()=>{setMobile(media.matches);if(media.matches)setCollapsed(false)};sync();media.addEventListener("change",sync);return()=>media.removeEventListener("change",sync)},[]);
  useEffect(()=>{const close=(event:PointerEvent)=>{if(!accountRef.current?.contains(event.target as Node))accountRef.current?.removeAttribute("open")};document.addEventListener("pointerdown",close);return()=>document.removeEventListener("pointerdown",close)},[]);
  return <aside className={`dashboard-sidebar${collapsed?" collapsed":""}`}>
    <div className="sidebar-top"><button className="brand brand-toggle" disabled={mobile} onClick={()=>setCollapsed((value)=>!value)} type="button" aria-label={collapsed?(en?"Open sidebar":"Buka sidebar"):(en?"Close sidebar":"Tutup sidebar")}>{collapsed?"LH":"LinkHub"}</button></div>
    <details className="account-menu" ref={accountRef}><summary>{avatarUrl?<span className="sidebar-avatar has-photo" role="img" aria-label={`${name} profile`} style={{backgroundImage:`url(${avatarUrl})`}}/>:<span className="sidebar-avatar">{name.slice(0,1).toUpperCase()||"U"}</span>}<span className="sidebar-copy"><strong>{name||"Linktree"}</strong><small>{email}</small></span><span className="sidebar-copy" aria-hidden="true">⌄</span></summary><div className="account-dropdown" onClick={(event)=>{if((event.target as HTMLElement).closest("a,button"))accountRef.current?.removeAttribute("open")}}><div className="account-language"><span>{en?"Language":"Bahasa"}</span><LanguageSwitcher/></div><p className="switch-label">{en?"Switch Linktree":"Ganti Linktree"}</p>{linktrees.map((tree)=><form action={switchLinktree} key={tree.id}><input type="hidden" name="linktree_id" value={tree.id}/><button className={tree.id===activeId?"active-tree":""} type="submit"><span>{tree.name}</span><small>{tree.slug?`/${tree.slug}`:en?"No slug":"Belum ada slug"}</small></button></form>)}{linktrees.length<3?<Link className="new-tree-link" href={withLocale("/dashboard/new",locale)}>{en?"+ Create new Linktree":"+ Buat Linktree baru"}</Link>:<span className="tree-limit">{en?"Maximum 3 Linktrees":"Maksimal 3 Linktree"}</span>}<Link href={withLocale("/dashboard/account",locale)}><DashboardIcon name="account"/> {en?"Account":"Akun"}</Link>{slug?<Link href={withLocale(`/${slug}`,locale)}>{en?"View Linktree":"Lihat Linktree"}</Link>:null}{isAdmin?<Link href={withLocale("/admin",locale)}>{en?"Admin dashboard":"Dashboard admin"}</Link>:null}<form action={logout}><button type="submit">{en?"Logout":"Keluar"}</button></form></div></details>
    <nav className="sidebar-nav" aria-label="Dashboard"><p className="sidebar-copy">{en?"My Linktree":"Linktree Saya"}</p>{items.map((item)=><Link className={pathname.startsWith(item.href)?"active":""} href={withLocale(item.href,locale)} title={en?item.en:item.id} key={item.href}><DashboardIcon name={item.icon}/><span className="sidebar-copy">{en?item.en:item.id}</span></Link>)}</nav>
  </aside>;
}


