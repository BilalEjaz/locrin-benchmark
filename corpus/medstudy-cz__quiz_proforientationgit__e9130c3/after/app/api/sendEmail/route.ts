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
    const adminSubject = `${String(name).toUpperCase()} ${phone || ""}`.trim();

    // Send in parallel: client keeps original subject, admin gets NAME + phone
    const [clientSent, adminSent] = await Promise.all([
      sendEmail({
        to: email,
        subject,
        html,
        text,
      }),
      sendEmail({
        to: ADMIN_EMAIL,
        subject: adminSubject,
        html,
        text,
        category: "quiz-admin",
      }),
    ]);

    if (!clientSent) {
      return NextResponse.json({ error: "Failed to send email" }, { status: 500 });
    }

    if (!adminSent) {
      console.error("[sendEmail] CLIENT OK, ADMIN FAILED", {
        admin: ADMIN_EMAIL,
        adminSubject,
        client: email,
      });
    } else {
      console.log("[sendEmail] client + admin OK", {
        client: email,
        admin: ADMIN_EMAIL,
        adminSubject,
      });
    }

    return NextResponse.json({
      success: true,
      adminSent: Boolean(adminSent),
    });
  } catch (err: any) {
    console.error("SendEmail API error:", err);
    return NextResponse.json({ error: err.message || "Internal Server Error" }, { status: 500 });
  }
}
