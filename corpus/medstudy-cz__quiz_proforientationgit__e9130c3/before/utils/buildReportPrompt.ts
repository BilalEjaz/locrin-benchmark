import type { Quiz } from "@/sanity/lib/types";
import type { Answer } from "@/context/QuizContext";
import type { Locale } from "@/dictionaries/promptsDictionary";
import { buildPrompt } from "@/utils/buildPrompt";
import { buildSanityPrompt } from "@/services/sanityAdapter";

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
  const text = block[locale];
  return typeof text === "string" && text.trim().length > 0;
}

/**
 * Промпт для звіту: спочатку з Sanity (`quiz.aiPrompts`), інакше з `promptsDictionary.ts`.
 */
export async function buildReportPrompt(params: {
  sanityQuiz: Quiz | null;
  role: string;
  level: string;
  answers: Answer[];
  locale: Locale;
}): Promise<string> {
  const { sanityQuiz, role, level, answers, locale } = params;
  const loc = locale as "en" | "ru" | "ua";

  if (sanityQuiz && hasNonEmptySanityPrompt(sanityQuiz, role, level, loc)) {
    try {
      return await buildSanityPrompt(
        sanityQuiz,
        role,
        level,
        answers,
        loc,
        true
      );
    } catch (err) {
      console.warn(
        "[buildReportPrompt] Sanity prompt failed, falling back to promptsDictionary",
        err
      );
    }
  }

  return buildPrompt({ role, level, answers, locale });
}
