import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const locales=["id","en"] as const;
export async function proxy(request:NextRequest){
  const {pathname}=request.nextUrl;
  if(pathname.startsWith("/api/"))return updateSession(request);
  const locale=locales.find((item)=>pathname===`/${item}`||pathname.startsWith(`/${item}/`));
  // Situs full English: /id/... dan path tanpa prefix diarahkan ke /en/... supaya link lama tetap jalan.
  if(locale!=="en"){const rest=locale?pathname.slice(locale.length+1):pathname;const url=request.nextUrl.clone();url.pathname=`/en${rest==="/"?"":rest}`;return NextResponse.redirect(url);}
  const url=request.nextUrl.clone();url.pathname=pathname.slice(locale.length+1)||"/";
  const headers=new Headers(request.headers);headers.set("x-linkhub-locale",locale);
  const response=await updateSession(request,url,headers);response.cookies.set("locale",locale,{sameSite:"lax",path:"/",maxAge:31536000});return response;
}
export const config={matcher:["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]};
