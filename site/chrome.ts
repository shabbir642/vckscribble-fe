import type { Plugin } from 'vite';

/**
 * The guide pages: plain HTML at the project root, one per search people
 * make (drawdle.in/skribbl-alternative and so on). Plain so every crawler
 * reads them whole and they load at once; served as {path}.html by Caddy and
 * by Vite's dev server alike.
 *
 * What every page shares (icons, the header with the logo, the footer with
 * links to the others) is written once here and dropped in where a page says
 * <!--site:head-->, <!--site:header--> and <!--site:footer-->.
 */
export const PAGES = [
  { file: 'online-pictionary.html', path: '/online-pictionary', label: 'Online Pictionary' },
  { file: 'skribbl-alternative.html', path: '/skribbl-alternative', label: 'skribbl.io alternative' },
  { file: 'how-to-play.html', path: '/how-to-play', label: 'How to play' },
  { file: 'indian-pictionary-words.html', path: '/indian-pictionary-words', label: 'Indian Pictionary words' },
];

const SITE = 'https://drawdle.in';
const COLORS = ['#ffd23f', '#2bd46e', '#ff5fa2', '#8fe3ff', '#ff8a3d', '#ffffff', '#ffd23f'];
const TILTS = [-6, 4, -3, 7, -5, 3, -7];

/** The wordmark as in components/Logo.tsx, without React. */
const logo = [...'Drawdle']
  .map(
    (ch, i) =>
      `<span aria-hidden="true" style="color:${COLORS[i]};--tilt:${TILTS[i]}deg">${ch}</span>`,
  )
  .join('');

const head = `
    <meta name="theme-color" content="#4231E0" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Drawdle" />
    <meta property="og:image" content="${SITE}/og.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:locale" content="en_IN" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-32.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <script type="module" src="/src/site.ts"></script>`;

const header = `
    <header class="site-head">
      <a class="logo" href="/" aria-label="Drawdle home">
        <img class="logo-mark" src="/src/assets/mascot.png" alt="" aria-hidden="true" />${logo}
      </a>
      <a class="cta small" href="/">Play free</a>
    </header>`;

const footer = (current: string) => `
    <footer class="site-foot">
      <nav aria-label="Guides">
        <a href="/">Play Drawdle</a>
        ${PAGES.map((p) =>
          p.path === current
            ? `<a href="${p.path}" aria-current="page">${p.label}</a>`
            : `<a href="${p.path}">${p.label}</a>`,
        ).join('\n        ')}
      </nav>
      <p>Drawdle is not affiliated with skribbl.io or with Mattel, which owns the Pictionary trademark.</p>
    </footer>`;

export function siteChrome(): Plugin {
  return {
    name: 'drawdle-site-chrome',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const page = PAGES.find((p) => ctx.filename.endsWith(`/${p.file}`));
        if (!page) return html;
        return html
          .replace('<!--site:head-->', head)
          .replace('<!--site:header-->', header)
          .replace('<!--site:footer-->', footer(page.path));
      },
    },
  };
}
