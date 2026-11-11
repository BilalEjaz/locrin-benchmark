import { GoogleGenAI } from "@google/genai";
import { ASSIGNMENTS } from './src/data/questions';

function generateHash(str: string): string {
  if (typeof str !== 'string' || str.length > 10000) return '0';
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & 0x7FFFFFFF;
  }
  return Math.abs(hash).toString(16);
}

export function sanitizeLaTeX(text: string): string {
  if (!text || typeof text !== 'string') return text;
  
  // Remove cite tags like [cite: 2875] or [cite: 414, 415]
  let cleaned = text.replace(/\s*\[cite:[^\]]+\]/gi, '');

  // Convert standalone unescaped bracket math blocks: \n[\n ... \n]\n or [\n ... \n] to $$ ... $$
  cleaned = cleaned.replace(/(?:^|\n)\s*\[\s*\n?([\s\S]*?)\n?\s*\]\s*(?=\n|$)/g, (match, p1) => {
    if (p1.includes('\\') || p1.includes('=') || p1.includes('_') || p1.includes('^') || p1.includes('+') || p1.includes('/') || p1.includes('\\frac') || p1.includes('\\text')) {
      return `\n\n$$\n${p1.trim()}\n$$\n\n`;
    }
    return match;
  });

  // Convert \[ ... \] to $$ ... $$
  cleaned = cleaned.replace(/\\\[([\s\S]*?)\\\]/g, '\n$$\n$1\n$$\n');

  // Convert \( ... \) to $ ... $
  cleaned = cleaned.replace(/\\\(([\s\S]*?)\\\)/g, '$$1$');

  return cleaned.trim();
}

const OPENCODE_MODELS = [
  "deepseek-v4-flash"
];

const GEMINI_MODELS = [
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-preview",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite"
];

const SUPABASE_URL = process.env.SUPABASE_URL;
// Server-side script: use the secret service_role key (never commit keys to the repo)
const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("ERROR: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.");
  process.exit(1);
}

const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY || process.env.DEEPSEEK_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!OPENCODE_API_KEY && !GEMINI_API_KEY) {
  console.error("ERROR: Neither OPENCODE_API_KEY nor GEMINI_API_KEY environment variable is set.");
  process.exit(1);
}

const ai = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;

async function fetchExistingKeys(): Promise<Set<string>> {
  const keys = new Set<string>();
  let offset = 0;
  const limit = 1000;
  while (true) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/explanations?select=cache_key&limit=${limit}&offset=${offset}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const rows: { cache_key: string }[] = await res.json();
    rows.forEach(r => keys.add(r.cache_key));
    if (rows.length < limit) break;
    offset += limit;
  }
  return keys;
}

async function saveExplanationToSupabase(cacheKey: string, text: string): Promise<boolean> {
  const sanitizedText = sanitizeLaTeX(text);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/explanations?on_conflict=cache_key`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates'
    },
    body: JSON.stringify({ cache_key: cacheKey, explanation_text: sanitizedText })
  });

  if (!res.ok) {
    console.error(`Failed to save ${cacheKey} to Supabase: HTTP ${res.status}`);
    return false;
  }
  return true;
}

async function generateWithOpenCode(question: any): Promise<string> {
  const prompt = `Provide a concise but high-yield explanation for this BCBR question. 
Do NOT include introductory phrases like "As an expert medical researcher" or "As a doctor". Jump straight into the content.
Include a clever memory hack or study aid to remember the answer.

Important Math Rule: Always use standard KaTeX block math $$ ... $$ or inline math $ ... $ for equations and formulas. Never use standalone brackets like [ ... ] for equations.
Important Text Rule: Do NOT include any citation tags like [cite: 1234] or [cite: ...].

Question: ${question.text}
Options: ${question.options.join(', ')}
Correct Answer: ${question.options[question.correctAnswer]}
Basic Explanation: ${question.explanation || ''}

Format the response in clear Markdown with a "Memory Hack" section.`;

  let lastError: any = null;
  for (const modelName of OPENCODE_MODELS) {
    try {
      const res = await fetch('https://opencode.ai/zen/go/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENCODE_API_KEY}`,
          'Content-Type': 'application/json',
          'x-opencode-session': 'bcbr-batch-generation'
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: 'You are an expert medical educator specializing in BCBR exam prep. Never output [cite: ...] markers.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 1000
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`OpenCode Error (${modelName}) HTTP ${res.status}: ${errText.slice(0, 100)}`);
      }

      const data: any = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return sanitizeLaTeX(text);
    } catch (err: any) {
      lastError = err;
      console.warn(`  [OpenCode ${modelName} failed]:`, err?.message || err);
    }
  }
  throw lastError || new Error("OpenCode generation failed");
}

async function generateWithGemini(question: any): Promise<string> {
  const prompt = `Provide a concise but high-yield explanation for this BCBR question. 
Do NOT include introductory phrases like "As an expert medical researcher" or "As a doctor". Jump straight into the content.
Include a clever memory hack or study aid to remember the answer.

Important Math Rule: Always use standard KaTeX block math $$ ... $$ or inline math $ ... $ for equations and formulas. Never use standalone brackets like [ ... ] for equations.
Important Text Rule: Do NOT include any citation tags like [cite: 1234] or [cite: ...].

Question: ${question.text}
Options: ${question.options.join(', ')}
Correct Answer: ${question.options[question.correctAnswer]}
Basic Explanation: ${question.explanation || ''}

Format the response in clear Markdown with a "Memory Hack" section.`;

  let lastError: any = null;
  for (const modelName of GEMINI_MODELS) {
    let retries = 0;
    while (retries < 2) {
      try {
        const response = await ai!.models.generateContent({
          contents: prompt,
          model: modelName
        });
        const text = response.text?.trim();
        if (text) return sanitizeLaTeX(text);
      } catch (err: any) {
        lastError = err;
        const msg = err?.message || err?.toString() || '';
        if (err?.status === 401 || err?.status === 403 || msg.includes("API_KEY_INVALID")) {
          throw err;
        }
        if (err?.status === 404 || msg.includes("NOT_FOUND") || msg.includes("no longer available")) {
          break;
        }
        if (err?.status === 429 || msg.includes("429") || msg.includes("quota")) {
          console.log(`  [Quota Limit on ${modelName}] Waiting 15s...`);
          await new Promise(r => setTimeout(r, 15000));
          retries++;
          continue;
        }
        break;
      }
    }
  }
  throw lastError || new Error("Failed to generate explanation with Gemini");
}

async function generateExplanation(question: any): Promise<string> {
  if (OPENCODE_API_KEY) {
    return await generateWithOpenCode(question);
  }
  return await generateWithGemini(question);
}

async function main() {
  const provider = OPENCODE_API_KEY ? "OpenCode AI (deepseek-v4-flash)" : "Google Gemini";
  console.log(`Using AI Provider: ${provider}`);
  console.log("Fetching existing explanation keys from Supabase...");
  const existingKeys = await fetchExistingKeys();
  console.log(`Found ${existingKeys.size} existing explanations in Supabase.\n`);

  const allQuestions = ASSIGNMENTS.flatMap(a => a.questions);
  const missingQuestions = allQuestions.filter(q => {
    const key = `concise_${generateHash(q.text)}`;
    return !existingKeys.has(key);
  });

  console.log(`Total questions: ${allQuestions.length}`);
  console.log(`Questions needing explanations: ${missingQuestions.length}\n`);

  if (missingQuestions.length === 0) {
    console.log("All questions already have explanations in Supabase!");
    return;
  }

  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < missingQuestions.length; i++) {
    const q = missingQuestions[i];
    const key = `concise_${generateHash(q.text)}`;
    console.log(`[${i + 1}/${missingQuestions.length}] Generating for question: "${q.text.slice(0, 60)}..."`);

    try {
      const text = await generateExplanation(q);
      const saved = await saveExplanationToSupabase(key, text);
      if (saved) {
        successCount++;
        console.log(`  ✓ Saved to Supabase (${key})`);
      } else {
        failCount++;
      }
    } catch (err: any) {
      failCount++;
      console.error(`  ✗ Generation failed:`, err?.message || err);
      if (err?.message?.includes("HTTP 401") || err?.message?.includes("HTTP 403")) {
        console.error("\nStopping process due to invalid API key.");
        break;
      }
    }

    const delayMs = OPENCODE_API_KEY ? 300 : 5000;
    await new Promise(r => setTimeout(r, delayMs));
  }

  console.log(`\nBatch complete!`);
  console.log(`Successfully generated & saved: ${successCount}`);
  console.log(`Failed: ${failCount}`);
}

main().catch(console.error);
