import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

import { isTrustedFeishuUrl, validateTagSet } from './lib/posts';

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
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: tagsSchema,
    featured: z.boolean().default(false),
    cover: z.string().optional(),
    sourceUrl: z
      .url()
      .refine(isTrustedFeishuUrl, {
        message:
          'Source URL must use HTTPS on a trusted feishu.cn or larksuite.com host.',
      })
      .optional(),
    feishuRecordId: z.string().optional(),
    slug: z
      .string()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Slug must contain lowercase ASCII letters, numbers, and single hyphens only.',
      )
      .optional(),
  }),
});

export const collections = { posts };
