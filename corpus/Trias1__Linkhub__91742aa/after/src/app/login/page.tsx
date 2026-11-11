import Link from "next/link";
import { login } from "@/app/auth/actions";
import { AuthLayout } from "@/components/auth-layout";
import { PasswordInput } from "@/components/password-input";
import { Turnstile } from "@/components/turnstile";

export const metadata = { title: "Sign in · LinkHub" };

export default async function LoginPage({searchParams}:{searchParams:Promise<{error?:string;message?:string}>}) {
  const query=await searchParams;
  return <AuthLayout tab="login" title="Welcome back" subtitle="Sign in to manage your products and links." error={query.error} message={query.message}><form action={login} className="lh-form"><input name="website" type="hidden"/><label className="lh-field">Email<input autoComplete="email" name="email" required type="email"/></label><PasswordInput autoComplete="current-password"/><Link className="lh-text-link lh-right" href="/en/forgot-password">Forgot password?</Link><Turnstile locale="en"/><button className="lh-btn">Sign in</button></form></AuthLayout>;
}
