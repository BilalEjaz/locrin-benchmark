import Link from "next/link";
import { requestPasswordReset } from "@/app/auth/actions";
import { withLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
import { Turnstile } from "@/components/turnstile";
export default async function ForgotPasswordPage({searchParams}:{searchParams:Promise<{message?:string}>}){const query=await searchParams;const locale=await getLocale();const en=locale==="en";return <main className="auth-shell"><section className="auth-card"><div className="header-actions"><Link className="brand" href={withLocale("/",locale)}>LinkHub</Link></div><h1>{en?"Reset password":"Atur ulang kata sandi"}</h1><p>{en?"Enter your account email to receive a reset link.":"Masukkan email akunmu untuk menerima tautan reset."}</p>{query.message?<p className="notice">{query.message}</p>:null}<form action={requestPasswordReset} className="stack"><input name="website" type="hidden"/><label>Email<input name="email" type="email" required autoComplete="email"/></label><Turnstile locale={locale}/><button>{en?"Send reset link":"Kirim tautan reset"}</button><Link className="text-link" href={withLocale("/login",locale)}>{en?"Back to sign in":"Kembali ke login"}</Link></form></section></main>;}

