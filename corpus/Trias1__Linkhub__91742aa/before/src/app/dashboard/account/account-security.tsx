"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { changePassword, deleteAccount, deleteLinktreeAccount, removeTrustedDevice, savePrivacy, trustCurrentDevice } from "../actions";
import { createClient } from "@/lib/supabase/client";
import type { Locale } from "@/lib/i18n";

type Factor = { id:string; factor_type:string; friendly_name?:string; status:string };
type Device = { id:string; label:string; expires_at:string; created_at:string };

export function AccountSecurity({ allowDataSharing, devices, slug, canDeleteLinktree, initialFactors,locale }: { locale:Locale; allowDataSharing:boolean; devices:Device[]; slug:string; canDeleteLinktree:boolean; initialFactors:Factor[] }) {
  const router = useRouter();
  const en=locale==="en";
  const [factors,setFactors]=useState<Factor[]>(initialFactors);
  const [message,setMessage]=useState("");
  const [totp,setTotp]=useState<{ id:string; qr:string; secret:string } | null>(null);

  async function loadFactors() {
    const { data }=await createClient().auth.mfa.listFactors();
    setFactors((data?.all??[]) as Factor[]);
  }

  async function enrollTotp() {
    setMessage("");
    const supabase=createClient();
    const stale=factors.find((item)=>item.factor_type==="totp"&&item.status!=="verified");
    if(stale) await supabase.auth.mfa.unenroll({factorId:stale.id});
    const { data,error }=await supabase.auth.mfa.enroll({ factorType:"totp", friendlyName:"LinkHub Authenticator" });
    if (error) return setMessage(error.message);
    setTotp({ id:data.id, qr:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.totp.qr_code.slice(data.totp.qr_code.indexOf(",")+1))}`, secret:data.totp.secret });
  }
  async function verifyTotp(formData:FormData) {
    if (!totp) return;
    const { error }=await createClient().auth.mfa.challengeAndVerify({ factorId:totp.id, code:String(formData.get("code")??"") });
    if (error) return setMessage(error.message);
    setTotp(null); setMessage("Authenticator App berhasil diaktifkan"); await loadFactors();
  }
  async function removeFactor(id:string) {
    const { error }=await createClient().auth.mfa.unenroll({ factorId:id });
    setMessage(error?.message??"MFA berhasil dinonaktifkan");
    if (!error) await loadFactors();
  }
  async function trustDevice() {
    const result=await trustCurrentDevice();
    setMessage(result.error??"Perangkat ini dipercaya selama 30 hari");
    if (!result.error) router.refresh();
  }

  return <>
    {message?<p className="notice" role="status">{message}</p>:null}
    <section className="account-section">
      <div className="account-section-heading"><div><h2>{en?"Security and privacy":"Keamanan dan privasi"}</h2><p>{en?"Manage how you access and protect your account.":"Kelola cara kamu mengakses dan melindungi akun."}</p></div></div>
      <div className="account-subsection"><div><h3>Multi-Factor Authentication (MFA)</h3><p>{en?"Add an extra layer of security to your account on top of your password.":"Tambahkan lapisan keamanan tambahan selain kata sandi."}</p></div></div>
      <div className="account-setting-row"><div><strong>{en?"Authenticator App":"Aplikasi Authenticator"}</strong><p>{en?"Use an authenticator app to verify your identity.":"Gunakan aplikasi authenticator untuk memverifikasi identitas."}</p></div>{factors.some((item)=>item.factor_type==="totp"&&item.status==="verified")?<button className="secondary" onClick={()=>void removeFactor(factors.find((item)=>item.factor_type==="totp"&&item.status==="verified")!.id)} type="button">{en?"Disable":"Nonaktifkan"}</button>:<button onClick={()=>void enrollTotp()} type="button">{en?"Enable":"Aktifkan"}</button>}</div>
      {totp?<form action={verifyTotp} className="account-inline-panel totp-panel"><Image alt="Authenticator QR code" height={180} src={totp.qr} unoptimized width={180}/><div><p>{en?"Scan the QR code or enter the secret:":"Pindai QR atau masukkan kode rahasia:"}</p><code>{totp.secret}</code><label>{en?"Authenticator code":"Kode authenticator"}<input name="code" inputMode="numeric" minLength={6} required/></label><button>{en?"Verify":"Verifikasi"}</button></div></form>:null}
      <div className="account-setting-row"><div><strong>{en?"Trusted devices":"Perangkat terpercaya"}</strong><p>{en?"Trust this browser for 30 days after MFA verification.":"Percayai browser ini selama 30 hari setelah verifikasi MFA."}</p></div><button onClick={()=>void trustDevice()} type="button">{en?"Trust this device":"Percayai perangkat ini"}</button></div>
      {devices.length?<div className="trusted-device-list">{devices.map((device)=><form action={removeTrustedDevice} key={device.id}><input name="device_id" type="hidden" value={device.id}/><span><strong>{device.label}</strong><small>Expires {new Date(device.expires_at).toLocaleDateString("id-ID")}</small></span><button className="secondary">Remove</button></form>)}</div>:null}
    </section>

    <section className="account-section"><div className="account-subsection"><div><h2>{en?"Privacy Settings":"Pengaturan privasi"}</h2><p>{en?"Control whether your data may be shared with third-party services.":"Atur apakah data dapat dibagikan ke layanan pihak ketiga."}</p></div></div><form action={savePrivacy} className="account-setting-row"><div><strong>{en?"Allow data sharing":"Izinkan berbagi data"}</strong><p>Data sharing preference for third-party services.</p><span className="account-status">{allowDataSharing?"Enabled":"Disabled"}</span></div><input name="allow_data_sharing" type="hidden" value={allowDataSharing?"false":"true"}/><button className="secondary">{allowDataSharing?"Disable":"Enable"}</button></form></section>

    <section className="account-section"><form action={changePassword} className="account-password-form"><div><h2>{en?"Change password":"Ubah kata sandi"}</h2><p>{en?"Set a new password with at least 8 characters.":"Buat kata sandi baru minimal 8 karakter."}</p></div><label>{en?"New password":"Kata sandi baru"}<input autoComplete="new-password" minLength={8} name="password" required type="password"/></label><label>{en?"Confirm password":"Ulangi kata sandi"}<input autoComplete="new-password" minLength={8} name="confirmation" required type="password"/></label><button>{en?"Update password":"Perbarui kata sandi"}</button></form></section>

    <section className="account-section"><div className="account-subsection"><div><h2>{en?"Account management":"Pengelolaan akun"}</h2><p>{en?"Deletion is permanent and cannot be undone.":"Penghapusan bersifat permanen dan tidak dapat dibatalkan."}</p></div></div><form action={deleteLinktreeAccount} className="account-danger-zone"><div><h3>{en?"Delete Linktree":"Hapus Linktree"}</h3><p>Type <strong>{slug}</strong> to delete the selected Linktree.</p><input name="confirmation" placeholder={slug} required/></div><button className="danger" disabled={!canDeleteLinktree}>{en?"Delete Linktree":"Hapus Linktree"}</button></form><form action={deleteAccount} className="account-danger-zone"><div><h3>{en?"Delete account":"Hapus akun"}</h3><p>Type <strong>DELETE</strong> to delete your account and every Linktree you own.</p><input name="confirmation" pattern="DELETE" placeholder="DELETE" required/></div><button className="danger">{en?"Delete account":"Hapus akun"}</button></form></section>
  </>;
}





