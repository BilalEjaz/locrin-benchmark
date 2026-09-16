import { promptsData, reportLanguageInstruction, Locale, PromptKey } from "@/dictionaries/promptsDictionary";
import type { Answer } from "@/context/QuizContext";
import { formatAnswers } from "./formatAnswers";
import {
  formatUniversitiesForPrompt,
  layerInstruction,
  type UniversityLayer,
} from "./formatUniversitiesForPrompt";

function joinTemplateFields(template: Record<string, string>): string {
  return Object.values(template).join("\n\n");
}

export function buildPrompt({
  role,
  level,
  answers,
  locale: _locale,
  universityLayer = 1,
}: {
  role: string;
  level: string;
  answers: Answer[];
  locale: Locale;
  universityLayer?: UniversityLayer;
}): string {
  const key: PromptKey =
    role === "parent" ? "parent" : (`student_${level}` as PromptKey);

  const reportTemplates = promptsData.reportGeneration;
  const roleTemplate =
    key in reportTemplates && key !== "common"
      ? reportTemplates[key as Exclude<PromptKey, "common">]
      : null;

  const template = {
    ...reportTemplates.common,
    ...(roleTemplate ?? {}),
  };

  const openAnswers = answers
    .filter((a) => a.answer)
    .map((a) => a.answer)
    .join("; ");

  let templateText = joinTemplateFields(template as Record<string, string>);

  templateText = templateText.replace(/{openAnswers}/g, openAnswers);

  const universitiesBlock = formatUniversitiesForPrompt(universityLayer);

  return `
${templateText}

---

Вот ответы пользователя:
${formatAnswers(answers, _locale)}

${layerInstruction(universityLayer)}

Университеты и факультеты:
${universitiesBlock}

${reportLanguageInstruction}
`.trim();
}
