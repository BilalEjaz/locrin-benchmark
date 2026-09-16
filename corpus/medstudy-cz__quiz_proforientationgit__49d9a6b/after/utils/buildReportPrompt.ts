import type { Quiz } from "@/sanity/lib/types";
import type { Answer } from "@/context/QuizContext";
import type { Locale } from "@/dictionaries/promptsDictionary";
import { noPlaceholdersInstruction } from "@/dictionaries/promptsDictionary";
import { buildPrompt } from "@/utils/buildPrompt";
import { buildSanityPrompt } from "@/services/sanityAdapter";
import type { UniversityLayer } from "@/utils/formatUniversitiesForPrompt";

function withOutputGuards(prompt: string): string {
  return `${prompt}\n\n---\n\n${noPlaceholdersInstruction}`;
}

function hasNonEmptySanityPrompt(
  quiz: Quiz,
  role: string,
  level: string,
  locale: "en" | "ru" | "ua"
): boolean {
  const prompts = quiz.aiPrompts;
  if (!prompts) return false;
  const key =
    role === "parent"
      ? "parent"
      : (`student_${level}` as keyof typeof prompts);
  const block = prompts[key];
  if (!block || typeof block !== "object") return false;
  // Prefer Russian template; fall back to locale / any non-empty
  const text =
    (typeof block.ru === "string" && block.ru.trim()) ||
    (typeof block[locale] === "string" && block[locale].trim()) ||
    "";
  return text.length > 0;
}

/**
 * Промпт для отчёта: Sanity (`quiz.aiPrompts`) или `promptsDictionary.ts`.
 * universityLayer: 1 — curated, 2 — расширенный каталог.
 */
export async function buildReportPrompt(params: {
  sanityQuiz: Quiz | null;
  role: string;
  level: string;
  answers: Answer[];
  locale: Locale;
  universityLayer?: UniversityLayer;
}): Promise<string> {
  const {
    sanityQuiz,
    role,
    level,
    answers,
    locale,
    universityLayer = 1,
  } = params;
  const loc = locale as "en" | "ru" | "ua";

  if (sanityQuiz && hasNonEmptySanityPrompt(sanityQuiz, role, level, loc)) {
    try {
      return withOutputGuards(
        await buildSanityPrompt(
          sanityQuiz,
          role,
          level,
          answers,
          loc,
          true,
          undefined,
          universityLayer
        )
      );
    } catch (err) {
      console.warn(
        "[buildReportPrompt] Sanity prompt failed, falling back to promptsDictionary",
        err
      );
    }
  }

  return withOutputGuards(
    buildPrompt({ role, level, answers, locale, universityLayer })
  );
}
