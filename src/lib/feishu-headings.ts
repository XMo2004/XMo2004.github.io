import {
  transformFeishuMarkup,
  type ArticleHeading,
} from './feishu-markup.ts';

export type { ArticleHeading } from './feishu-markup.ts';

export function extractFeishuHeadings(
  markdown: string,
): readonly ArticleHeading[] | undefined {
  return transformFeishuMarkup(markdown).headings;
}
