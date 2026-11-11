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

const SUPABASE_URL = process.env.SUPABASE_URL;
// Server-side script: use the secret service_role key (never commit keys to the repo)
const SUPABASE_ANON_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("ERROR: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.");
  process.exit(1);
}
const OPENCODE_API_KEY = process.env.OPENCODE_API_KEY || process.env.DEEPSEEK_API_KEY;

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
  const res = await fetch(`${SUPABASE_URL}/rest/v1/explanations`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ cache_key: cacheKey, explanation_text: sanitizedText })
  });

  if (res.ok || res.status === 409) {
    return true;
  }

  const errText = await res.text();
  console.error(`Failed to save ${cacheKey} to Supabase: HTTP ${res.status} - ${errText.slice(0, 120)}`);
  return false;
}

async function generateWithDeepSeek(question: any): Promise<string> {
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

  const res = await fetch('https://opencode.ai/zen/go/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENCODE_API_KEY}`,
      'Content-Type': 'application/json',
      'x-opencode-session': 'bcbr-parallel-workers'
    },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      messages: [
        { role: 'system', content: 'You are an expert medical educator specializing in BCBR exam prep.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 1000
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenCode Error HTTP ${res.status}: ${errText.slice(0, 100)}`);
  }

  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty response");
  return sanitizeLaTeX(text);
}

async function main() {
  console.log("=== High-Speed Parallel Explanation Generator ===");
  console.log("Fetching existing explanation keys from Supabase...");
  const existingKeys = await fetchExistingKeys();
  console.log(`Found ${existingKeys.size} existing explanations in Supabase.\n`);

  const allQuestions = ASSIGNMENTS.flatMap(a => a.questions);
  const missingQuestions = allQuestions.filter(q => {
    const key = `concise_${generateHash(q.text)}`;
    return !existingKeys.has(key);
  });

  console.log(`Total questions: ${allQuestions.length}`);
  console.log(`Missing explanations to generate: ${missingQuestions.length}\n`);

  if (missingQuestions.length === 0) {
    console.log("All questions already have explanations in Supabase!");
    return;
  }

  let queueIndex = 0;
  let successCount = 0;
  let failCount = 0;
  const CONCURRENCY = 4; // 4 parallel worker threads

  async function worker(workerId: number) {
    while (true) {
      const idx = queueIndex++;
      if (idx >= missingQuestions.length) break;

      const q = missingQuestions[idx];
      const key = `concise_${generateHash(q.text)}`;
      const itemNum = idx + 1;

      try {
        const text = await generateWithDeepSeek(q);
        const saved = await saveExplanationToSupabase(key, text);
        if (saved) {
          successCount++;
          console.log(`[Worker ${workerId}] (${itemNum}/${missingQuestions.length}) ✓ Saved ${key}`);
        } else {
          failCount++;
        }
      } catch (err: any) {
        failCount++;
        console.error(`[Worker ${workerId}] (${itemNum}/${missingQuestions.length}) ✗ Error:`, err?.message || err);
      }
    }
  }

  console.log(`Launching ${CONCURRENCY} parallel worker threads...`);
  const startTime = Date.now();
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1)));

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n🎉 All workers completed in ${elapsedSec}s!`);
  console.log(`Successfully generated & saved: ${successCount}`);
  console.log(`Failed: ${failCount}`);
}

main().catch(console.error);
