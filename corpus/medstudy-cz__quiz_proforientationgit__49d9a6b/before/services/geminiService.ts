const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_VERSION = "v1beta";
const GEMINI_MODEL = "gemini-2.5-flash";

const GEMINI_API_URL =
  `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}/models/${GEMINI_MODEL}:generateContent`;

  function cleanHtml(html: string) {
    return html
      .replace(/^```html\s*/i, "")
      .replace(/^html\s*/i, "")
      .replace(/```$/i, "")
      .trim();
  }
  
  export async function generateReport(prompt: string) {
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set");
    }
  
    const payload = {
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    };
  
    const res = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-goog-api-key": GEMINI_API_KEY,
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
  
    const text =
      data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  
    return cleanHtml(text);
  }