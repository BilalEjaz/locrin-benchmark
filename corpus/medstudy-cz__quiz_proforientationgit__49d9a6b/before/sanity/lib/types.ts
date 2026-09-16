export interface LocalizedText {
  en: string
  ru: string
  ua: string
}

export interface LocalizedArray {
  en: string[]
  ru: string[]
  ua: string[]
}

export type Direction = 'MED' | 'TECH' | 'HUM' | 'ECO' | 'NAT'

export interface University {
  _id: string
  name: LocalizedText
  direction: Direction
  faculties: LocalizedArray
  city?: LocalizedText
  website?: string
  order: number
  isActive: boolean
}

export interface School {
  _id: string
  name: LocalizedText
  direction: Direction
  type?: string
  city?: LocalizedText
  website?: string
  order: number
  isActive: boolean
}

export interface Answer {
  text: LocalizedText
  value: string
  score?: number
}

export interface Question {
  _id: string
  title: string | LocalizedText  // SimpleQuestion uses string, old Question uses LocalizedText
  language?: string  // Only for SimpleQuestion
  description?: string | LocalizedText
  type: 'single' | 'multiple' | 'text'
  answers?: Answer[] | Array<{ text: string; value?: string; tags?: string[] }>  // SimpleQuestion has different format
  required: boolean
  order?: number  // Optional now
}

export interface EmailSettings {
  subject?: LocalizedText
  includeAnswers?: boolean
}

export interface MetaData {
  estimatedTime?: number
  category?: 'professional' | 'career' | 'skills' | 'other'
}

export interface AnalyticsSettings {
  trackingId?: string
  enableFacebookPixel?: boolean
  enableTikTokPixel?: boolean
}

export interface RolePrompts {
  student_grade_9?: LocalizedText
  student_grade_11?: LocalizedText
  student_bachelor?: LocalizedText
  parent?: LocalizedText
}

/** Optional per-locale strings for start screen; empty = use app locale JSON */
export type LocalizedStringField = Partial<Record<'en' | 'ru' | 'ua', string>>

export interface QuizStartScreen {
  title?: LocalizedStringField
  description?: LocalizedStringField
  button?: LocalizedStringField
  footer?: LocalizedStringField
  feature1?: LocalizedStringField
  feature2?: LocalizedStringField
  feature3?: LocalizedStringField
}

export interface RoleQuestions {
  student_grade_9?: {
    en?: Array<Question | { _ref: string; _type: string }>
    ru?: Array<Question | { _ref: string; _type: string }>
    ua?: Array<Question | { _ref: string; _type: string }>
  }
  student_grade_11?: {
    en?: Array<Question | { _ref: string; _type: string }>
    ru?: Array<Question | { _ref: string; _type: string }>
    ua?: Array<Question | { _ref: string; _type: string }>
  }
  student_bachelor?: {
    en?: Array<Question | { _ref: string; _type: string }>
    ru?: Array<Question | { _ref: string; _type: string }>
    ua?: Array<Question | { _ref: string; _type: string }>
  }
  parent?: {
    en?: Array<Question | { _ref: string; _type: string }>
    ru?: Array<Question | { _ref: string; _type: string }>
    ua?: Array<Question | { _ref: string; _type: string }>
  }
}

export interface Quiz {
  _id: string
  slug: {
    current: string
  }
  title: LocalizedText
  description?: LocalizedText
  startScreen?: QuizStartScreen
  isActive: boolean
  aiPrompts: RolePrompts
  questions: RoleQuestions
  emailSettings?: EmailSettings
  metaData?: MetaData
  analytics?: AnalyticsSettings
}

export interface QuizListItem {
  _id: string
  slug: {
    current: string
  }
  title: LocalizedText
  description?: LocalizedText
  metaData?: MetaData
  isActive: boolean
}

export interface QuizAnswer {
  questionId: string
  questionTitle: string
  answer: string | string[]
}

export interface QuizSession {
  quizId: string
  locale: string
  answers: QuizAnswer[]
  email?: string
  completedAt?: Date
}
