import { promptsData, langInstructions, Locale, PromptKey } from "@/dictionaries/promptsDictionary";
import type { Answer } from "@/context/QuizContext";
import { DirectionType, educationalInstitutionsDictionary, SchoolDirectionType } from "@/dictionaries/educationalInstitutionsDictionary";
import { formatAnswers } from "./formatAnswers";

function joinTemplateFields(template: Record<string, string>): string {
  return Object.values(template).join("\n\n");
}

function getTopDirectionTag(answers: Answer[]): string {
  const tagCount: Record<string, number> = {};
  answers.forEach((a) => {
    a.tags?.forEach((tag) => {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    });
  });
  const sortedTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1]);
  return sortedTags[0]?.[0] || "MED";
}

export function buildPrompt({
  role,
  level,
  answers,
  locale,
}: {
  role: string;
  level: string;
  answers: Answer[];
  locale: Locale;
}): string {

  // Определяем ключ шаблона
  const key: PromptKey = role === "parent" ? "parent" : (`student_${level}` as PromptKey);

  // Безопасный доступ к reportGeneration
  const reportTemplates = promptsData[locale].reportGeneration;
  const template = reportTemplates[key] ?? reportTemplates.common;

  // Собираем ответы пользователя в текст
  const openAnswers = answers.filter((a) => a.answer).map((a) => a.answer).join("; ");

  // Определяем топ-направление
  const topDirectionTag = getTopDirectionTag(answers);
  const dirLabels = promptsData[locale].DIR_LABELS as Record<string, string>;
  const topDirection = dirLabels[topDirectionTag] ?? topDirectionTag;

  // Получаем соответствующие университеты и школы
  const topUniDirection = topDirectionTag as DirectionType;
  const topSchoolDirection = topDirectionTag as SchoolDirectionType;

  const uniList = educationalInstitutionsDictionary.UNI[topUniDirection];
  const schoolList = educationalInstitutionsDictionary.SCHOOL_TYPES[topSchoolDirection];

  // Объединяем все поля шаблона
  let templateText = joinTemplateFields(template);

  // Подставляем плейсхолдеры
  templateText = templateText
    .replace(/{openAnswers}/g, openAnswers)
    .replace(/{languagePreference}/g, locale)
    .replace(/{topDirection}/g, topDirection);

  // Инструкция по языку
  const langInstruction = langInstructions[locale] ?? langInstructions["ua"];

  // Формируем финальный промт с ответами пользователя
  const finalPrompt = `
${templateText}

---

Вот ответы пользователя:
${formatAnswers(answers, locale)}
  
  Университети:
${uniList.map(u => `${u.name}: ${u.faculties.join(", ")}`).join("\n")}

Школы:
${schoolList.join("\n")}

${langInstruction}
`;

  return finalPrompt;
}
