import { z } from 'astro/zod';

const publicAssetPath = z.string().regex(
  /^\/(?!\/)[^\\\s?#]+$/,
  'Cover paths must be same-origin absolute paths without backslashes, whitespace, a query or a fragment.',
);

export const responsiveCoverSchema = z
  .object({
    src: publicAssetPath,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    variants: z
      .array(
        z.object({
          src: publicAssetPath,
          width: z.number().int().positive(),
        }),
      )
      .min(1),
  })
  .superRefine((cover, context) => {
    const variantPaths = new Set<string>();

    for (const [index, variant] of cover.variants.entries()) {
      const previousVariant = cover.variants[index - 1];

      if (previousVariant && variant.width <= previousVariant.width) {
        context.addIssue({
          code: 'custom',
          message: 'Cover variant widths must be strictly increasing.',
          path: ['variants', index, 'width'],
        });
      }

      if (variantPaths.has(variant.src)) {
        context.addIssue({
          code: 'custom',
          message: 'Cover variant paths must be unique.',
          path: ['variants', index, 'src'],
        });
      }

      variantPaths.add(variant.src);
    }

    const finalVariantIndex = cover.variants.length - 1;
    const finalVariant = cover.variants[finalVariantIndex];

    if (finalVariant && finalVariant.src !== cover.src) {
      context.addIssue({
        code: 'custom',
        message: 'The final cover variant src must match the top-level src.',
        path: ['variants', finalVariantIndex, 'src'],
      });
    }

    if (finalVariant && finalVariant.width !== cover.width) {
      context.addIssue({
        code: 'custom',
        message: 'The final cover variant width must match the top-level width.',
        path: ['variants', finalVariantIndex, 'width'],
      });
    }
  });

export const coverSchema = z.union([z.string(), responsiveCoverSchema]);

export type Cover = z.infer<typeof coverSchema>;
export type ResponsiveCover = z.infer<typeof responsiveCoverSchema>;
