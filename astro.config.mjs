import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import { SITE } from './src/config/site.ts';

export default defineConfig({
  site: SITE.canonicalOrigin,
  output: 'static',
  integrations: [sitemap()],
});
