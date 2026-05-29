// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';

const SITE = 'https://mcp-tool-shop-org.github.io';
const BASE = '/attestia';
const OG_IMAGE = `${SITE}${BASE}/og-image.png`;
const OG_DESCRIPTION =
  'Financial truth infrastructure for the decentralized world — structural governance, deterministic accounting, and human-approved intent.';

export default defineConfig({
  site: SITE,
  base: BASE,
  integrations: [
    starlight({
      title: 'Attestia',
      description: 'Attestia handbook',
      favicon: '/favicon.svg',
      head: [
        // Open Graph
        { tag: 'meta', attrs: { property: 'og:type', content: 'website' } },
        { tag: 'meta', attrs: { property: 'og:title', content: 'Attestia' } },
        { tag: 'meta', attrs: { property: 'og:description', content: OG_DESCRIPTION } },
        { tag: 'meta', attrs: { property: 'og:image', content: OG_IMAGE } },
        { tag: 'meta', attrs: { property: 'og:url', content: `${SITE}${BASE}/` } },
        // Twitter / X
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
        { tag: 'meta', attrs: { name: 'twitter:title', content: 'Attestia' } },
        { tag: 'meta', attrs: { name: 'twitter:description', content: OG_DESCRIPTION } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: OG_IMAGE } },
      ],
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/mcp-tool-shop-org/Attestia' },
      ],
      sidebar: [
        { label: 'Handbook', autogenerate: { directory: 'handbook' } },
      ],
      customCss: ['./src/styles/starlight-custom.css'],
      disable404Route: true,
    }),
  ],
  vite: { plugins: [tailwindcss()] },
});
