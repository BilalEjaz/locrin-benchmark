import Link from "next/link";

const points = ["Shopee, Tokopedia and TikTok Shop products on one page", "See which product gets the most clicks", "Every feature is free, no subscription"];

// Kerangka halaman masuk/daftar/reset: panel gelap di kiri (desktop), form di kanan.
export function AuthLayout({ tab, title, subtitle, error, message, children }: { tab?: "login" | "signup"; title: string; subtitle?: string; error?: string; message?: string; children: React.ReactNode }) {
  return <main className="lh-auth">
    <section className="lh-auth-intro">
      <Link className="lh-brand" href="/en">Link<b>Hub</b></Link>
      <div><h1>One link for all your stores.</h1><ul>{points.map((point) => <li key={point}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7" /></svg>{point}</li>)}</ul></div>
      <small>Free Linktree alternative for sellers and affiliates.</small>
    </section>
    <section className="lh-auth-panel">
      <div className="lh-auth-card">
        {tab ? <nav className="lh-tabs" aria-label="Account"><Link href="/en/login" aria-current={tab === "login" ? "page" : undefined}>Sign in</Link><Link href="/en/signup" aria-current={tab === "signup" ? "page" : undefined}>Sign up</Link></nav> : null}
        <h2>{title}</h2>
        {subtitle ? <p className="lh-auth-sub">{subtitle}</p> : null}
        {error ? <p className="lh-alert" role="alert">{error}</p> : null}
        {message ? <p className="lh-ok" role="status">{message}</p> : null}
        {children}
      </div>
    </section>
  </main>;
}
