import Link from "next/link";
import { notFound } from "next/navigation";
import { getDashboardContext } from "@/lib/active-linktree";

export default async function AdminPage() {
  const { supabase, isAdmin } = await getDashboardContext();
  if (!isAdmin) notFound();

  const [{ count: users }, { count: links }, { count: views }, { count: clicks }, { data: recentUsers }] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("links").select("id", { count: "exact", head: true }),
    supabase.from("page_views").select("id", { count: "exact", head: true }),
    supabase.from("link_clicks").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id,name,slug,created_at").order("created_at", { ascending: false }).limit(20),
  ]);

  return (
    <main className="admin-shell">
      <header className="dashboard-header"><Link className="brand" href="/">LinkHub Admin</Link><Link className="text-link" href="/dashboard">Dashboard user</Link></header>
      <section className="admin-stats">
        <article><span>Total user</span><strong>{users ?? 0}</strong></article><article><span>Total link</span><strong>{links ?? 0}</strong></article><article><span>Page views</span><strong>{views ?? 0}</strong></article><article><span>Link clicks</span><strong>{clicks ?? 0}</strong></article>
      </section>
      <section className="panel"><p className="section-label">20 terbaru</p><h1>User terdaftar</h1><div className="user-table"><div className="user-row user-head"><span>Nama</span><span>Slug</span><span>Bergabung</span></div>{recentUsers?.map((item) => <div className="user-row" key={item.id}><strong>{item.name || "Tanpa nama"}</strong><span>{item.slug ? `/${item.slug}` : "Belum diatur"}</span><time>{new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(item.created_at))}</time></div>)}</div></section>
    </main>
  );
}