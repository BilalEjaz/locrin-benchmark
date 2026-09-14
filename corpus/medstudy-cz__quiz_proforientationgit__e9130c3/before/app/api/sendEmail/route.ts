import { NextRequest, NextResponse } from "next/server";
import { sendEmail } from "@/integrations/email";

const ADMIN_EMAIL = "adm.cur.medstudy@gmail.com";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { name, email, phone, subject, html } = body;

    if (!name || !email || !html || !subject) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const text = html.replace(/<\/?[^>]+(>|$)/g, "");

    const success = await sendEmail({
      to: email,
      subject,
      html,
      text,
    });

    if (!success) {
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    const adminSubject = `${String(name).toUpperCase()} ${phone || ""}`.trim();
    const adminSent = await sendEmail({
      to: ADMIN_EMAIL,
      subject: adminSubject,
      html,
      text,
    });

    if (!adminSent) {
      console.error("Failed to send admin copy to", ADMIN_EMAIL);
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("SendEmail API error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
