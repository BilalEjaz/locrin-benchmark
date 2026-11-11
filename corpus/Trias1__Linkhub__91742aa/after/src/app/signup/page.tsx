import Link from "next/link";
import { signup } from "@/app/auth/actions";
import { AuthLayout } from "@/components/auth-layout";
import { PasswordInput } from "@/components/password-input";
import { Turnstile } from "@/components/turnstile";

export const metadata = { title: "Sign up · LinkHub" };

export default async function SignupPage({searchParams}:{searchParams:Promise<{error?:string}>}) {
  const query=await searchParams;
  return <AuthLayout tab="signup" title="Create your page" subtitle="Free, with every feature included." error={query.error}><form action={signup} className="lh-form"><input name="website" type="hidden"/><label className="lh-field">Email<input autoComplete="email" name="email" required type="email"/></label><PasswordInput autoComplete="new-password" hint="At least 8 characters."/><Turnstile locale="en"/><button className="lh-btn">Create account</button><p className="lh-legal">By signing up you agree to the <Link href="/en/terms">Terms</Link> and <Link href="/en/privacy">Privacy Policy</Link>. We will email you a confirmation link.</p></form></AuthLayout>;
}
