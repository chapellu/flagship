// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// SSR on purpose: articles are MDX files that land in a shared volume at
// runtime (git-sync sidecar), so nothing about them can be resolved at build
// time. Every route renders per request — see src/lib/content.js.
export default defineConfig({
  site: 'https://blog.chapellu.fr',
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  trailingSlash: 'never',
});
