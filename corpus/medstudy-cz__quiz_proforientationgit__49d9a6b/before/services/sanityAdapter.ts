/**
 * Адаптер для преобразования данных из Sanity CMS
 * в формат, который ожидает существующее приложение
 */

import type {
  Quiz,
  Question as SanityQuestion,
  Direction,
  LocalizedText,
} from '@/sanity/lib/types'
import type { QuestionBankLanguage, Question, Option } from '@/dictionaries/quizDictionary'
import { educationalInstitutionsDictionary, DirectionType, SchoolDirectionType } from '@/dictionaries/educationalInstitutionsDictionary'
import type { Answer } from '@/context/QuizContext'
import { getUniversitiesByDirection, getSchoolsByDirection } from '@/sanity/lib/api'

/**
 * Преобразует вопрос из Sanity в формат приложения
 */
function convertSanityQuestionToAppFormat(
  sanityQuestion: SanityQuestion,
  locale: 'en' | 'ru' | 'ua'
): Question {
  // Определяем, это SimpleQuestion (title: string) или старый Question (title: LocalizedText)
  const isSimpleQuestion = typeof sanityQuestion.title === 'string'

  const questionText = isSimpleQuestion
    ? sanityQuestion.title as string
    : ((sanityQuestion.title as LocalizedText)[locale] ?? '')

  const question: Question = {
    type: sanityQuestion.type === 'text' ? 'open-ended' : 'multiple-choice',
    question: questionText,
  }

  // Для вопросов с вариантами ответов
  if (sanityQuestion.type !== 'text' && sanityQuestion.answers) {
    // SimpleQuestion: answers = [{ text: string, tags: string[] }]
    // Old Question: answers = [{ text: LocalizedText }]
    question.options = sanityQuestion.answers.map((answer: any) => {
      const answerText = typeof answer.text === 'string'
        ? answer.text
        : ((answer.text as LocalizedText)[locale] ?? '')

      return {
        answers: [answerText],
        tags: answer.tags || [],
      }
    })
  }

  return question
}

/**
 * Преобразует массив вопросов из Sanity в формат приложения
 */
function convertQuestionsList(
  questions: Array<SanityQuestion | { _ref: string; _type: string }> | undefined,
  locale: 'en' | 'ru' | 'ua'
): Question[] {
  if (!questions || questions.length === 0) {
    console.log('⚠️ convertQuestionsList: пустой массив вопросов');
    return []
  }

  console.log('🔍 convertQuestionsList input:', {
    questionsCount: questions.length,
    firstQuestion: questions[0],
    allAreReferences: questions.every(q => '_ref' in q && !('title' in q))
  });

  // Фильтруем только загруженные вопросы (не ссылки)
  const loadedQuestions = questions.filter(
    (q): q is SanityQuestion => '_id' in q && 'title' in q
  )

  console.log('📦 Loaded questions:', {
    total: questions.length,
    loaded: loadedQuestions.length,
    references: questions.length - loadedQuestions.length
  });

  // Преобразуем вопросы напрямую (теперь все SimpleQuestion)
  const converted = loadedQuestions.map((q) => convertSanityQuestionToAppFormat(q, locale));
  console.log('✅ Converted questions:', converted.length);
  
  return converted;
}

/**
 * Преобразует квиз из Sanity в формат QuestionBank
 */
export function adaptSanityQuizToQuestionBank(
  quiz: Quiz,
  locale: 'en' | 'ru' | 'ua'
): QuestionBankLanguage {
  const { questions } = quiz

  console.log('🔍 Debug adaptSanityQuizToQuestionBank:', {
    locale,
    questionsStructure: questions,
    student_grade_9: questions.student_grade_9?.[locale],
    student_grade_11: questions.student_grade_11?.[locale],
    student_bachelor: questions.student_bachelor?.[locale],
    parent: questions.parent?.[locale],
  })

  const result = {
    student: {
      grade_9: convertQuestionsList(questions.student_grade_9?.[locale], locale),
      grade_11: convertQuestionsList(questions.student_grade_11?.[locale], locale),
      bachelor: convertQuestionsList(questions.student_bachelor?.[locale], locale),
    },
    parent: {
      all: convertQuestionsList(questions.parent?.[locale], locale),
    },
  }

  console.log('✅ Converted result:', result);

  return result
}

/**
 * Получает AI промпт из квиза Sanity для конкретной роли
 */
export function getSanityAIPrompt(
  quiz: Quiz,
  role: string,
  level: string,
  locale: 'en' | 'ru' | 'ua'
): string {
  // Определяем ключ промпта на основе роли и уровня
  const promptKey = role === 'parent' ? 'parent' : `student_${level}` as keyof typeof quiz.aiPrompts

  const rolePrompt = quiz.aiPrompts[promptKey]
  if (!rolePrompt) {
    throw new Error(`Prompt not found for role "${role}" and level "${level}"`)
  }

  const text = rolePrompt[locale]
  if (text === undefined || text === '') {
    throw new Error(`Prompt text missing for locale "${locale}" (role "${role}", level "${level}")`)
  }
  return text
}

/**
 * Форматирует ответы для AI промпта
 */
export function formatAnswersForPrompt(
  questions: SanityQuestion[],
  answers: Array<{ question: string; answer: string }>,
  locale: 'en' | 'ru' | 'ua'
): string {
  return answers
    .map((ans, idx) => {
      const question = questions[idx]
      if (!question) return ''

      // Определяем, это SimpleQuestion (title: string) или старый Question (title: LocalizedText)
      const isSimpleQuestion = typeof question.title === 'string'
      const questionText = isSimpleQuestion
        ? question.title as string
        : ((question.title as LocalizedText)[locale] ?? '')

      return `${questionText}: ${ans.answer}`
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Получает топ направление на основе ответов
 */
function getTopDirectionTag(answers: Answer[]): string {
  const tagCount: Record<string, number> = {}
  answers.forEach((a) => {
    a.tags?.forEach((tag) => {
      tagCount[tag] = (tagCount[tag] || 0) + 1
    })
  })
  const sortedTags = Object.entries(tagCount).sort((a, b) => b[1] - a[1])
  return sortedTags[0]?.[0] || 'MED'
}

/**
 * Заменяет плейсхолдеры в промпте реальными данными и добавляет списки университетов из Sanity
 */
export async function buildSanityPrompt(
  quiz: Quiz,
  role: string,
  level: string,
  answers: Answer[],
  locale: 'en' | 'ru' | 'ua',
  useSanityInstitutions: boolean = true,
  additionalData?: Record<string, string>
): Promise<string> {
  let prompt = getSanityAIPrompt(quiz, role, level, locale)

  // Форматируем ответы
  const openAnswers = answers.filter((a) => a.answer).map((a) => a.answer).join('; ')

  // Определяем топ-направление
  const topDirectionTag = getTopDirectionTag(answers)
  const direction = topDirectionTag as Direction

  // Получаем университеты и школы
  let universitiesList = ''
  let schoolsList = ''

  if (useSanityInstitutions) {
    // Загружаем из Sanity
    const [universities, schools] = await Promise.all([
      getUniversitiesByDirection(direction),
      getSchoolsByDirection(direction),
    ])

    universitiesList = universities
      .map((u) => {
        const name = u.name[locale] ?? ''
        const fac = u.faculties[locale]
        const facStr = Array.isArray(fac) ? fac.join(', ') : ''
        return `${name}: ${facStr}`
      })
      .join('\n')

    schoolsList = schools
      .map((s) => s.name[locale] ?? '')
      .join('\n')
  } else {
    // Fallback к старому словарю
    const topUniDirection = topDirectionTag as DirectionType
    const topSchoolDirection = topDirectionTag as SchoolDirectionType

    const uniList = educationalInstitutionsDictionary.UNI[topUniDirection] || []
    const schoolList =
      educationalInstitutionsDictionary.SCHOOL_TYPES[topSchoolDirection] || []

    universitiesList = uniList
      .map((u) => `${u.name}: ${u.faculties.join(', ')}`)
      .join('\n')
    schoolsList = schoolList.join('\n')
  }

  // Заменяем базовые плейсхолдеры
  prompt = prompt
    .replace(/{openAnswers}/g, openAnswers)
    .replace(/{topDirection}/g, topDirectionTag)
    .replace(/{languagePreference}/g, locale)

  // Заменяем дополнительные плейсхолдеры
  if (additionalData) {
    Object.entries(additionalData).forEach(([key, value]) => {
      prompt = prompt.replace(new RegExp(`{${key}}`, 'g'), value)
    })
  }

  // Добавляем списки университетов и школ в конец промпта
  const finalPrompt = `
${prompt}

---

Вот ответы пользователя:
${answers.map((a) => `${a.question}: ${a.answer}`).filter(Boolean).join('\n')}

Университети:
${universitiesList}

Школы:
${schoolsList}
`

  return finalPrompt
}
