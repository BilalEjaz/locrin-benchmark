"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trustCurrentDevice } from "@/app/dashboard/actions";

type Factor={id:string;factor_type:string;friendly_name?:string};

export function MfaChallenge({next}:{next:string}){
  const router=useRouter();
  const [factors,setFactors]=useState<Factor[]>([]);
  const [factorId,setFactorId]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{void (async()=>{const {data}=await createClient().auth.mfa.listFactors();const verified=(data?.all??[]).filter((item)=>item.status==="verified") as Factor[];setFactors(verified);setFactorId(verified[0]?.id??"");})();},[]);
  async function verify(formData:FormData){
    const factor=factors.find((item)=>item.id===factorId); if(!factor)return setError("MFA factor tidak ditemukan");
    const supabase=createClient(); const code=String(formData.get("code")??"");
    if(factor.factor_type==="phone") { const challenge=await supabase.auth.mfa.challenge({factorId,channel:"sms"}); if(challenge.error)return setError(challenge.error.message); const result=await supabase.auth.mfa.verify({factorId,challengeId:challenge.data.id,code}); if(result.error)return setError(result.error.message); }
    else { const result=await supabase.auth.mfa.challengeAndVerify({factorId,code}); if(result.error)return setError(result.error.message); }
    if(formData.get("trust")==="on") { const result=await trustCurrentDevice(); if(result.error)return setError(result.error); }
    router.push(next); router.refresh();
  }
  return <Dialog defaultOpen><DialogContent><DialogHeader><DialogTitle>Verifikasi keamanan</DialogTitle><DialogDescription>Masukkan kode MFA untuk melanjutkan ke dashboard.</DialogDescription></DialogHeader>{error?<p className="notice error" role="alert">{error}</p>:null}<form action={verify} className="stack"><label>Metode<select value={factorId} onChange={(event)=>setFactorId(event.target.value)}>{factors.map((factor)=><option key={factor.id} value={factor.id}>{factor.friendly_name||factor.factor_type}</option>)}</select></label><label>Kode<input name="code" inputMode="numeric" minLength={6} required/></label><label className="check"><input name="trust" type="checkbox"/> Percayai perangkat ini selama 30 hari</label><button disabled={!factorId}>Verify</button></form></DialogContent></Dialog>;
}

