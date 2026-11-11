import { updatePassword } from "@/app/auth/actions";
import { AuthLayout } from "@/components/auth-layout";
import { PasswordInput } from "@/components/password-input";

export const metadata = { title: "New password · LinkHub" };

export default async function ResetPasswordPage({searchParams}:{searchParams:Promise<{error?:string}>}){
  const query=await searchParams;
  return <AuthLayout title="Create a new password" error={query.error}><form action={updatePassword} className="lh-form"><PasswordInput label="New password" autoComplete="new-password" hint="At least 8 characters."/><PasswordInput name="confirmation" label="Confirm password" autoComplete="new-password"/><button className="lh-btn">Save password</button></form></AuthLayout>;
}
