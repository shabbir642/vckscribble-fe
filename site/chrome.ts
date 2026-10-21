import type { Plugin } from 'vite';
import { renderWordTokens } from './words';

/**
 * The guide pages: plain HTML at the project root, one per search people
 * make (drawdle.in/skribbl-alternative and so on). Plain so every crawler
 * reads them whole and they load at once; served as {path}.html by Caddy and
 * by Vite's dev server alike.
 *
 * What every page shares (icons, the header with the logo, the footer with
 * links to the others) is written once here and dropped in where a page says
 * <!--site:head-->, <!--site:header--> and <!--site:footer-->. Word lists and
 * their counts come from site/words.ts.
 */
export interface Page {
  file: string;
  path: string;
  label: string;
  /** The footer row it is linked from. */
  group: 'words' | 'guides';
}

export const PAGES: Page[] = [
  { file: 'pictionary-word-generator.html', path: '/pictionary-word-generator', label: 'Word generator', group: 'words' },
  { file: 'pictionary-words.html', path: '/pictionary-words', label: 'All Pictionary words', group: 'words' },
  { file: 'easy-pictionary-words.html', path: '/easy-pictionary-words', label: 'Easy words', group: 'words' },
  { file: 'hard-pictionary-words.html', path: '/hard-pictionary-words', label: 'Hard words', group: 'words' },
  { file: 'pictionary-words-for-kids.html', path: '/pictionary-words-for-kids', label: 'Words for kids', group: 'words' },
  { file: 'office-pictionary-words.html', path: '/office-pictionary-words', label: 'Office words', group: 'words' },
  { file: 'indian-pictionary-words.html', path: '/indian-pictionary-words', label: 'Indian words', group: 'words' },
  { file: 'skribbl-custom-words.html', path: '/skribbl-custom-words', label: 'skribbl custom words', group: 'words' },
  { file: 'online-pictionary.html', path: '/online-pictionary', label: 'Online Pictionary', group: 'guides' },
  { file: 'skribbl-alternative.html', path: '/skribbl-alternative', label: 'skribbl.io alternative', group: 'guides' },
  { file: 'how-to-play.html', path: '/how-to-play', label: 'How to play', group: 'guides' },
];

const GROUPS: { id: Page['group']; label: string }[] = [
  { id: 'words', label: 'Word lists' },
  { id: 'guides', label: 'Guides' },
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

const link = (path: string, label: string, current: string) =>
  path === current
    ? `<a href="${path}" aria-current="page">${label}</a>`
    : `<a href="${path}">${label}</a>`;

// Two rows, each named for screen readers by its nav and on screen by its
// label, so the label is hidden from the former.
const footer = (current: string) => `
    <footer class="site-foot">
      ${GROUPS.map((g) =>
        [
          `<nav aria-label="${g.label}">`,
          `  <span class="foot-label" aria-hidden="true">${g.label}</span>`,
          ...(g.id === 'guides' ? ['  <a href="/">Play Drawdle</a>'] : []),
          ...PAGES.filter((p) => p.group === g.id).map((p) => `  ${link(p.path, p.label, current)}`),
          '</nav>',
        ].join('\n      '),
      ).join('\n      ')}
      <p>Drawdle is not affiliated with skribbl.io or with Mattel, which owns the Pictionary trademark.</p>
    </footer>`;

export function siteChrome(): Plugin {
  return {
    name: 'drawdle-site-chrome',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const page = PAGES.find((p) => ctx.filename.endsWith(`/${p.file}`));
        // Function replacers: a string one reads `$&` and `$'` as patterns.
        const framed = page
          ? html
              .replace('<!--site:head-->', () => head)
              .replace('<!--site:header-->', () => header)
              .replace('<!--site:footer-->', () => footer(page.path))
          : html;
        // Every page, the game's included, may state word counts.
        return renderWordTokens(framed, page?.file ?? ctx.filename.split('/').pop() ?? ctx.filename);
      },
    },
  };
}
