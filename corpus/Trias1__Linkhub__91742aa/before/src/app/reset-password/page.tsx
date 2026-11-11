import Link from "next/link";
import { updatePassword } from "@/app/auth/actions";
import { withLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/i18n-server";
export default async function ResetPasswordPage({searchParams}:{searchParams:Promise<{error?:string}>}){const query=await searchParams;const locale=await getLocale();const en=locale==="en";return <main className="auth-shell"><section className="auth-card"><div className="header-actions"><Link className="brand" href={withLocale("/",locale)}>LinkHub</Link></div><h1>{en?"Create a new password":"Buat kata sandi baru"}</h1>{query.error?<p className="notice error">{query.error}</p>:null}<form action={updatePassword} className="stack"><label>{en?"New password":"Kata sandi baru"}<input name="password" type="password" minLength={8} required autoComplete="new-password"/></label><label>{en?"Confirm password":"Ulangi kata sandi"}<input name="confirmation" type="password" minLength={8} required autoComplete="new-password"/></label><button>{en?"Save password":"Simpan kata sandi"}</button></form></section></main>;}

