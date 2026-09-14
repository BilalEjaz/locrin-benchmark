import { defineType, defineField } from 'sanity'

export default defineType({
  name: 'quiz',
  title: 'Quiz',
  type: 'document',
  fields: [
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      description: 'Unique identifier for URL (e.g., "medical-orientation")',
      options: {
        source: 'title.en',
        maxLength: 96,
      },
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'title',
      title: 'Quiz Title',
      type: 'object',
      fields: [
        { name: 'en', title: 'English', type: 'string' },
        { name: 'ru', title: 'Russian', type: 'string' },
        { name: 'ua', title: 'Ukrainian', type: 'string' },
      ],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'description',
      title: 'Quiz Description',
      type: 'object',
      fields: [
        { name: 'en', title: 'English', type: 'text' },
        { name: 'ru', title: 'Russian', type: 'text' },
        { name: 'ua', title: 'Ukrainian', type: 'text' },
      ],
    }),
    defineField({
      name: 'isActive',
      title: 'Is Active',
      type: 'boolean',
      description: 'Enable/disable this quiz',
      initialValue: true,
    }),
    defineField({
      name: 'startScreen',
      title: 'Start screen copy',
      type: 'object',
      description:
        'Optional texts for the quiz landing/start step. Leave empty to use app defaults (locales).',
      fields: [
        {
          name: 'title',
          title: 'Title (above card)',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'string' },
            { name: 'ru', title: 'Russian', type: 'string' },
            { name: 'ua', title: 'Ukrainian', type: 'string' },
          ],
        },
        {
          name: 'description',
          title: 'Description',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'text', rows: 4 },
            { name: 'ru', title: 'Russian', type: 'text', rows: 4 },
            { name: 'ua', title: 'Ukrainian', type: 'text', rows: 4 },
          ],
        },
        {
          name: 'button',
          title: 'Start button',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'string' },
            { name: 'ru', title: 'Russian', type: 'string' },
            { name: 'ua', title: 'Ukrainian', type: 'string' },
          ],
        },
        {
          name: 'footer',
          title: 'Footer note',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'text', rows: 3 },
            { name: 'ru', title: 'Russian', type: 'text', rows: 3 },
            { name: 'ua', title: 'Ukrainian', type: 'text', rows: 3 },
          ],
        },
        {
          name: 'feature1',
          title: 'Feature 1 (e.g. Free)',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'string' },
            { name: 'ru', title: 'Russian', type: 'string' },
            { name: 'ua', title: 'Ukrainian', type: 'string' },
          ],
        },
        {
          name: 'feature2',
          title: 'Feature 2 (e.g. 5 min)',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'string' },
            { name: 'ru', title: 'Russian', type: 'string' },
            { name: 'ua', title: 'Ukrainian', type: 'string' },
          ],
        },
        {
          name: 'feature3',
          title: 'Feature 3 (e.g. Expert tips)',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'string' },
            { name: 'ru', title: 'Russian', type: 'string' },
            { name: 'ua', title: 'Ukrainian', type: 'string' },
          ],
        },
      ],
    }),
    defineField({
      name: 'aiPrompts',
      title: 'AI Analysis Prompts',
      type: 'object',
      description: 'Different prompts for different user roles and education levels',
      fields: [
        {
          name: 'student_grade_9',
          title: 'Student - 9th Grade',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'text', rows: 15 },
            { name: 'ru', title: 'Russian', type: 'text', rows: 15 },
            { name: 'ua', title: 'Ukrainian', type: 'text', rows: 15 },
          ],
          description: 'Prompt for 9th grade students',
        },
        {
          name: 'student_grade_11',
          title: 'Student - 11th Grade',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'text', rows: 15 },
            { name: 'ru', title: 'Russian', type: 'text', rows: 15 },
            { name: 'ua', title: 'Ukrainian', type: 'text', rows: 15 },
          ],
          description: 'Prompt for 11th grade students',
        },
        {
          name: 'student_bachelor',
          title: 'Student - Bachelor/Graduate',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'text', rows: 15 },
            { name: 'ru', title: 'Russian', type: 'text', rows: 15 },
            { name: 'ua', title: 'Ukrainian', type: 'text', rows: 15 },
          ],
          description: 'Prompt for bachelor students and graduates',
        },
        {
          name: 'parent',
          title: 'Parent',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'text', rows: 15 },
            { name: 'ru', title: 'Russian', type: 'text', rows: 15 },
            { name: 'ua', title: 'Ukrainian', type: 'text', rows: 15 },
          ],
          description: 'Prompt for parents',
        },
      ],
      validation: (Rule) => Rule.required(),
    }),
    defineField({
      name: 'questions',
      title: 'Questions by Role & Language',
      type: 'object',
      description: 'Questions organized by user role/level and language',
      fields: [
        // Student - 9th Grade
        {
          name: 'student_grade_9',
          title: 'Student - 9th Grade',
          type: 'object',
          fields: [
            {
              name: 'en',
              title: 'English',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
            {
              name: 'ru',
              title: 'Russian',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
            {
              name: 'ua',
              title: 'Ukrainian',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
          ],
        },
        // Student - 11th Grade
        {
          name: 'student_grade_11',
          title: 'Student - 11th Grade',
          type: 'object',
          fields: [
            {
              name: 'en',
              title: 'English',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
            {
              name: 'ru',
              title: 'Russian',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
            {
              name: 'ua',
              title: 'Ukrainian',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
          ],
        },
        // Student - Bachelor
        {
          name: 'student_bachelor',
          title: 'Student - Bachelor/Graduate',
          type: 'object',
          fields: [
            {
              name: 'en',
              title: 'English',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
            {
              name: 'ru',
              title: 'Russian',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
            {
              name: 'ua',
              title: 'Ukrainian',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
          ],
        },
        // Parent
        {
          name: 'parent',
          title: 'Parent',
          type: 'object',
          fields: [
            {
              name: 'en',
              title: 'English',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
            {
              name: 'ru',
              title: 'Russian',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
            {
              name: 'ua',
              title: 'Ukrainian',
              type: 'array',
              of: [{ type: 'reference', to: [{ type: 'simpleQuestion' }] }],
            },
          ],
        },
      ],
    }),
    defineField({
      name: 'emailSettings',
      title: 'Email Settings',
      type: 'object',
      fields: [
        {
          name: 'subject',
          title: 'Email Subject Template',
          type: 'object',
          fields: [
            { name: 'en', title: 'English', type: 'string' },
            { name: 'ru', title: 'Russian', type: 'string' },
            { name: 'ua', title: 'Ukrainian', type: 'string' },
          ],
        },
        {
          name: 'includeAnswers',
          title: 'Include Answers in Email',
          type: 'boolean',
          initialValue: true,
        },
      ],
    }),
    defineField({
      name: 'metaData',
      title: 'Metadata',
      type: 'object',
      fields: [
        {
          name: 'estimatedTime',
          title: 'Estimated Completion Time (minutes)',
          type: 'number',
          initialValue: 5,
        },
        {
          name: 'category',
          title: 'Category',
          type: 'string',
          options: {
            list: [
              { title: 'Professional Orientation', value: 'professional' },
              { title: 'Career Assessment', value: 'career' },
              { title: 'Skills Assessment', value: 'skills' },
              { title: 'Other', value: 'other' },
            ],
          },
        },
      ],
    }),
    defineField({
      name: 'analytics',
      title: 'Analytics Settings',
      type: 'object',
      fields: [
        {
          name: 'trackingId',
          title: 'Custom Tracking ID',
          type: 'string',
          description: 'Optional custom ID for analytics',
        },
        {
          name: 'enableFacebookPixel',
          title: 'Enable Facebook Pixel',
          type: 'boolean',
          initialValue: true,
        },
        {
          name: 'enableTikTokPixel',
          title: 'Enable TikTok Pixel',
          type: 'boolean',
          initialValue: true,
        },
      ],
    }),
  ],
  preview: {
    select: {
      title: 'title.en',
      slug: 'slug.current',
      isActive: 'isActive',
    },
    prepare({ title, slug, isActive }) {
      return {
        title: title,
        subtitle: `/${slug} ${isActive ? '✓ Active' : '✗ Inactive'}`,
      }
    },
  },
})