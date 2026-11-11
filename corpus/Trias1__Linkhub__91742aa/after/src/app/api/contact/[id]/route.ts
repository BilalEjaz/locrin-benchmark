import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid, rateLimit, verifyTurnstile } from "@/lib/security";

export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const {id}=await params; const cookieName=`contact_${id}`;
  if(!isUuid(id))return NextResponse.json({error:"Linktree not found"},{status:404});
  if(request.cookies.has(cookieName)||!(await rateLimit("contact",5,600,request.headers)))return NextResponse.json({error:"Please wait a moment before sending again"},{status:429});
  const body=await request.json().catch(()=>null) as {name?:string;email?:string;company?:string;turnstile?:string}|null;
  const name=body?.name?.trim().slice(0,80)??""; const email=body?.email?.trim().slice(0,254)??"";
  if(body?.company||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return NextResponse.json({error:"Invalid contact details"},{status:400});
  if(!(await verifyTurnstile(body?.turnstile,request.headers)))return NextResponse.json({error:"Captcha check failed. Please try again."},{status:400});
  const supabase=createAdminClient(); if(!supabase)return NextResponse.json({error:"Contact service is not configured"},{status:503});
  const {data:tree}=await supabase.from("linktrees").select("owner_id").eq("id",id).single(); if(!tree)return NextResponse.json({error:"Linktree not found"},{status:404});
  const {error}=await supabase.from("contacts").insert({profile_id:tree.owner_id,linktree_id:id,name,email}); if(error)return NextResponse.json({error:"Could not send contact"},{status:400});
  const response=NextResponse.json({message:"Contact sent"});response.cookies.set(cookieName,"1",{httpOnly:true,sameSite:"lax",secure:process.env.NODE_ENV==="production",maxAge:60,path:"/"});return response;
}
