import { defineType, defineField } from 'sanity'

/**
 * Упрощенный вопрос без мультиязычности
 * Язык определяется тем, в каком наборе вопросов он используется
 */
export default defineType({
  name: 'simpleQuestion',
  title: 'Simple Question',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Question Text',
      type: 'text',
      rows: 3,
      description: 'The question text in a single language',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'language',
      title: 'Language',
      type: 'string',
      options: {
        list: [
          { title: 'English', value: 'en' },
          { title: 'Russian', value: 'ru' },
          { title: 'Ukrainian', value: 'ua' },
        ],
      },
      description: 'Which language is this question in?',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Description / Help Text',
      type: 'text',
      rows: 2,
      description: 'Optional additional context or help text',
    }),
    defineField({
      name: 'type',
      title: 'Question Type',
      type: 'string',
      options: {
        list: [
          { title: 'Single Choice (один ответ)', value: 'single' },
          {
            title: 'Multiple Choice (несколько ответов)',
            value: 'multiple',
          },
          { title: 'Text Input (свободный текст)', value: 'text' },
        ],
      },
      initialValue: 'single',
      description:
        'Multiple Choice — пользователь может отметить несколько вариантов и нажать «Далее».',
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'answers',
      title: 'Answer Options',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            {
              name: 'text',
              title: 'Answer Text',
              type: 'string',
              validation: (Rule: any) => Rule.required(),
            },
            {
              name: 'value',
              title: 'Value',
              type: 'string',
              description: 'Internal value for this answer',
            },
          ],
          preview: {
            select: {
              title: 'text',
            },
            prepare({ title }: any) {
              return {
                title: title,
              }
            },
          },
        },
      ],
      hidden: ({ parent }: any) => parent?.type === 'text',
    }),
    defineField({
      name: 'required',
      title: 'Required',
      type: 'boolean',
      description: 'Is this question required?',
      initialValue: true,
    }),
  ],
  preview: {
    select: {
      title: 'title',
      language: 'language',
      type: 'type',
    },
    prepare({ title, language, type }: any) {
      const typeLabel =
        type === 'multiple'
          ? 'multi-select'
          : type === 'text'
            ? 'text'
            : 'single'
      return {
        title: title,
        subtitle: `[${language?.toUpperCase()}] ${typeLabel}`,
      }
    },
  },
})
