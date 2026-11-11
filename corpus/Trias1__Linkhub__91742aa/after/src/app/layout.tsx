import type { Metadata } from "next";
import { Bebas_Neue, Caveat, DM_Sans, Geist, Inter, Lora, Merriweather, Montserrat, Nunito, Playfair_Display, Poppins, Space_Grotesk } from "next/font/google";
import "./globals.css";
import "./ui.css";
import { getLocale } from "@/lib/i18n-server";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["400", "600", "700"] });
const playfair = Playfair_Display({ variable: "--font-playfair", subsets: ["latin"] });
const space = Space_Grotesk({ variable: "--font-space", subsets: ["latin"] });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"] });
const lora = Lora({ variable: "--font-lora", subsets: ["latin"] });
const merriweather = Merriweather({ variable: "--font-merriweather", subsets: ["latin"] });
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"] });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"] });
const bebasNeue = Bebas_Neue({ variable: "--font-bebas-neue", subsets: ["latin"], weight: "400" });
const caveat = Caveat({ variable: "--font-caveat", subsets: ["latin"] });

export const metadata: Metadata = { title: "LinkHub — One link for everything", description: "A free link-in-bio page for your stores, products and links." };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return <html lang={locale}><body className={`${geist.variable} ${inter.variable} ${poppins.variable} ${playfair.variable} ${space.variable} ${dmSans.variable} ${lora.variable} ${merriweather.variable} ${nunito.variable} ${montserrat.variable} ${bebasNeue.variable} ${caveat.variable}`}>{children}</body></html>;
}
