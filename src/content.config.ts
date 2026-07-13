import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

import { coverSchema } from './lib/cover';
import { validateTagSet } from './lib/posts';

const tagsSchema = z
  .array(z.string().trim().min(1, 'Tags must not be empty.'))
  .superRefine((tags, context) => {
    for (const collision of validateTagSet(tags)) {
      context.addIssue({
        code: 'custom',
        message: `Tags "${collision.firstCanonicalTag}" and "${collision.secondCanonicalTag}" map to the same route slug "${collision.slug}".`,
      });
    }
  })
  .default([]);

const posts = defineCollection({
  loader: glob({
    base: './src/content/posts',
    pattern: '**/*.{md,mdx}',
  }),
  schema: z
    .object({
      title: z.string(),
      description: z.string(),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      category: z.string().trim().min(1, 'Category must not be empty.'),
      column: z
        .string()
        .trim()
        .min(1, 'Column must not be empty.')
        .optional(),
      columnOrder: z.number().int().positive().optional(),
      tags: tagsSchema,
      featured: z.boolean().default(false),
      cover: coverSchema.optional(),
      slug: z
        .string()
        .regex(
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
          'Slug must contain lowercase ASCII letters, numbers, and single hyphens only.',
        )
        .optional(),
    })
    .superRefine((post, context) => {
      const hasColumn = post.column !== undefined;
      const hasColumnOrder = post.columnOrder !== undefined;

      if (hasColumn !== hasColumnOrder) {
        context.addIssue({
          code: 'custom',
          message: 'Column and columnOrder must be provided together.',
          path: hasColumn ? ['columnOrder'] : ['column'],
        });
      }
    }),
});

export const collections = { posts };
