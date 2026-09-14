import { generateReport, needsBroaderCatalog } from "@/services/geminiService";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { promptText, promptTextFallback } = await req.json();

    if (!promptText) {
      return NextResponse.json(
        { error: "Prompt text is required" },
        { status: 400 }
      );
    }

    let report = await generateReport(promptText);
    let usedLayer: 1 | 2 = 1;

    if (needsBroaderCatalog(report) && promptTextFallback) {
      console.log("[report] Layer 1 insufficient → trying layer 2 catalog");
      report = await generateReport(promptTextFallback);
      usedLayer = 2;
    }

    if (needsBroaderCatalog(report)) {
      return NextResponse.json(
        {
          error:
            "Could not build a report from available university catalogs",
          report: null,
          usedLayer,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({ report, usedLayer });
  } catch (err) {
    console.error("❌ API fatal error:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Unknown error" },
      { status: 500 }
    );
  }
}
