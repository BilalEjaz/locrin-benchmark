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
          { title: 'Single Choice', value: 'single' },
          { title: 'Multiple Choice', value: 'multiple' },
          { title: 'Text Input', value: 'text' },
        ],
      },
      initialValue: 'single',
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
            {
              name: 'tags',
              title: 'Tags',
              type: 'array',
              of: [{ type: 'string' }],
              description: 'Tags for categorization (e.g., MED, TECH, HUM)',
              options: {
                list: [
                  { title: 'Medical', value: 'MED' },
                  { title: 'Technical', value: 'TECH' },
                  { title: 'Humanities', value: 'HUM' },
                  { title: 'Economics', value: 'ECO' },
                  { title: 'Natural Sciences', value: 'NAT' },
                ],
              },
            },
          ],
          preview: {
            select: {
              title: 'text',
              tags: 'tags',
            },
            prepare({ title, tags }: any) {
              return {
                title: title,
                subtitle: tags ? tags.join(', ') : '',
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
      return {
        title: title,
        subtitle: `[${language?.toUpperCase()}] ${type}`,
      }
    },
  },
})
