import Link from "next/link";
import { requestPasswordReset } from "@/app/auth/actions";
import { AuthLayout } from "@/components/auth-layout";
import { Turnstile } from "@/components/turnstile";

export const metadata = { title: "Reset password · LinkHub" };

export default async function ForgotPasswordPage({searchParams}:{searchParams:Promise<{message?:string;error?:string}>}){
  const query=await searchParams;
  return <AuthLayout title="Reset password" subtitle="Enter your account email and we will send you a reset link." error={query.error} message={query.message}><form action={requestPasswordReset} className="lh-form"><input name="website" type="hidden"/><label className="lh-field">Email<input name="email" type="email" required autoComplete="email"/></label><Turnstile locale="en"/><button className="lh-btn">Send reset link</button><Link className="lh-text-link" href="/en/login">Back to sign in</Link></form></AuthLayout>;
}
