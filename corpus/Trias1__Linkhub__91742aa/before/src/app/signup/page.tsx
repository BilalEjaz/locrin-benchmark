import Link from "next/link";
import { signup } from "@/app/auth/actions";
import { withLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { Turnstile } from "@/components/turnstile";

export default async function SignupPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const query=await searchParams; const locale=await getLocale(); const en=locale==="en";
  return <main className="auth-shell"><section className="auth-card"><div className="header-actions"><Link className="brand" href={withLocale("/",locale)}>LinkHub</Link></div><h1>{en?"Create your account":"Buat akun"}</h1><p>{en?"Start your LinkHub with email and password.":"Mulai LinkHub kamu dengan email dan kata sandi."}</p>{query.error?<p className="notice error" role="alert">{query.error}</p>:null}<form action={signup} className="stack"><input name="website" type="hidden"/><label>Email<input autoComplete="email" name="email" required type="email"/></label><label>{en?"Password":"Kata sandi"}<input autoComplete="new-password" minLength={8} name="password" required type="password"/></label><Turnstile locale={locale}/><button>{en?"Create account":"Buat akun"}</button><p>{en?"Already have an account? ":"Sudah punya akun? "}<Link className="text-link" href={withLocale("/login",locale)}>{en?"Sign in":"Masuk"}</Link></p></form></section></main>;
}
