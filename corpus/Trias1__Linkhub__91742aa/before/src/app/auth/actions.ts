"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { rateLimit, verifyTurnstile } from "@/lib/security";

const fail=(path:string,message:string):never=>redirect(`${path}?error=${encodeURIComponent(message)}`);
async function guard(formData:FormData,path:string,bucket:string,limit:number,windowSeconds:number){
  if(formData.get("website")) redirect(path);
  if(!(await rateLimit(bucket,limit,windowSeconds))) fail(path,"Terlalu banyak percobaan. Coba lagi beberapa menit lagi.");
  if(!(await verifyTurnstile(formData.get("cf-turnstile-response")))) fail(path,"Verifikasi captcha gagal. Coba lagi.");
}
function credentials(formData:FormData,errorPath="/login"){
  const email=String(formData.get("email")??"").trim(); const password=String(formData.get("password")??"");
  if(!email||password.length<8) fail(errorPath,"Email atau password tidak valid");
  return {email,password};
}
export async function login(formData:FormData){await guard(formData,"/login","login",10,900);const supabase=await createClient();const {error}=await supabase.auth.signInWithPassword(credentials(formData));if(error)fail("/login",error.code==="email_not_confirmed"?"Email belum dikonfirmasi. Cek kotak masuk email kamu.":"Email atau password salah");const {data:aal}=await supabase.auth.mfa.getAuthenticatorAssuranceLevel();redirect(aal?.nextLevel==="aal2"&&aal.currentLevel!=="aal2"?"/login/mfa":"/dashboard");}
// Pesan sukses yang sama untuk email baru maupun yang sudah terdaftar, supaya daftar email tidak bisa ditebak.
export async function signup(formData:FormData){await guard(formData,"/signup","signup",5,3600);const supabase=await createClient();const {error}=await supabase.auth.signUp(credentials(formData,"/signup"));if(error&&error.code!=="user_already_exists")fail("/signup",error.code==="weak_password"?"Password terlalu lemah. Pakai minimal 8 karakter, campur huruf dan angka.":"Pendaftaran gagal. Coba lagi beberapa saat lagi.");redirect("/login?message=Cek email untuk konfirmasi akun");}
export async function requestPasswordReset(formData:FormData){const done="/forgot-password?message=Jika email terdaftar, link reset akan dikirim";const email=String(formData.get("email")??"").trim();if(!email)redirect(done);await guard(formData,"/forgot-password","reset",5,3600);const supabase=await createClient();const siteUrl=process.env.NEXT_PUBLIC_SITE_URL??"http://localhost:3000";await supabase.auth.resetPasswordForEmail(email,{redirectTo:`${siteUrl}/auth/callback?next=/reset-password`});redirect(done);}
export async function updatePassword(formData:FormData){const password=String(formData.get("password")??"");const confirmation=String(formData.get("confirmation")??"");if(password.length<8||password!==confirmation)redirect("/reset-password?error=Password minimal 8 karakter dan harus sama");const supabase=await createClient();const {error}=await supabase.auth.updateUser({password});if(error)fail("/reset-password",error.code==="same_password"?"Password baru harus berbeda dari yang lama":"Password gagal diperbarui. Minta link reset baru.");redirect("/login?message=Password berhasil diperbarui");}
export async function logout(){const supabase=await createClient();await supabase.auth.signOut();redirect("/");}
