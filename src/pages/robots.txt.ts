import { SITE } from '../config/site';

const robots = [
  'User-agent: *',
  'Allow: /',
  `Sitemap: ${new URL('/sitemap-index.xml', SITE.canonicalOrigin).href}`,
  '',
].join('\n');

export function GET(): Response {
  return new Response(robots, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
