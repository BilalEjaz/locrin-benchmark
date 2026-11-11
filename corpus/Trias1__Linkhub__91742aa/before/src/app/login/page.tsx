import Link from "next/link";
import { login } from "@/app/auth/actions";
import { withLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { Turnstile } from "@/components/turnstile";

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string;message?:string}>}) {
  const query=await searchParams; const locale=await getLocale(); const en=locale==="en";
  return <main className="auth-shell"><section className="auth-card"><div className="header-actions"><Link className="brand" href={withLocale("/",locale)}>LinkHub</Link></div><h1>{en?"Welcome back":"Selamat datang kembali"}</h1><p>{en?"Sign in to manage your Linktree.":"Masuk untuk mengelola Linktree kamu."}</p>{query.error?<p className="notice error" role="alert">{query.error}</p>:null}{query.message?<p className="notice" role="status">{query.message}</p>:null}<form action={login} className="stack"><input name="website" type="hidden"/><label>Email<input autoComplete="email" name="email" required type="email"/></label><label>{en?"Password":"Kata sandi"}<input autoComplete="current-password" minLength={8} name="password" required type="password"/></label><Turnstile locale={locale}/><Link className="text-link" href={withLocale("/forgot-password",locale)}>{en?"Forgot password?":"Lupa kata sandi?"}</Link><button>{en?"Sign in":"Masuk"}</button><p>{en?"No account yet? ":"Belum punya akun? "}<Link className="text-link" href={withLocale("/signup",locale)}>{en?"Sign up":"Daftar"}</Link></p></form></section></main>;
}
