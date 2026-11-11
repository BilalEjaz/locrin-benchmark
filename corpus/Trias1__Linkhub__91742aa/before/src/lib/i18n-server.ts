import "server-only";
import { headers } from "next/headers";
import type { Locale } from "@/lib/i18n";
export async function getLocale():Promise<Locale>{return (await headers()).get("x-linkhub-locale")==="en"?"en":"id";}
