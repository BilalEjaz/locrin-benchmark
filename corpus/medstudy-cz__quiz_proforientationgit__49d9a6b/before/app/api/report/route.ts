import { generateReport } from "@/services/geminiService";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { promptText } = await req.json();

    if (!promptText) {
      return NextResponse.json(
        { error: "Prompt text is required" },
        { status: 400 }
      );
    }

    const report = await generateReport(promptText);

    return NextResponse.json({ report });
  } catch (err) {
    console.error("❌ API fatal error:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Unknown error" },
      { status: 500 }
    );
  }
}
