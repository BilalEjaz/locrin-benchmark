const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_VERSION = "v1beta";
const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_FALLBACK_MODEL = "gemini-2.0-flash";

function modelUrl(model: string) {
  return `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${model}:generateContent`;
}

function cleanHtml(html: string) {
  return html
    .replace(/^```html\s*/i, "")
    .replace(/^html\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

/** Layer 1 asked for broader catalog instead of HTML report */
export function needsBroaderCatalog(text: string | null | undefined): boolean {
  if (!text) return true;
  const normalized = text.replace(/[`"'«»]/g, "").trim();
  return (
    /NEED_BROADER_CATALOG/i.test(normalized) &&
    !/<h[1-6]|<p|<div/i.test(normalized)
  );
}

async function generateWithModel(prompt: string, model: string) {
  const payload = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
  };

  const res = await fetch(modelUrl(model), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-goog-api-key": GEMINI_API_KEY as string,
    },
    body: JSON.stringify(payload),
  });

  const rawText = await res.text();
  const data = JSON.parse(rawText);

  if (!res.ok) {
    throw new Error(
      `Gemini API error ${res.status}: ${JSON.stringify(data)}`
    );
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  return cleanHtml(text);
}

export async function generateReport(prompt: string) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  try {
    return await generateWithModel(prompt, GEMINI_MODEL);
  } catch (err) {
    console.warn(
      `[Gemini] ${GEMINI_MODEL} failed, retrying with ${GEMINI_FALLBACK_MODEL}`,
      err
    );
    return await generateWithModel(prompt, GEMINI_FALLBACK_MODEL);
  }
}
