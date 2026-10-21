#!/usr/bin/env node
/**
 * Vendors the seed word lists from the backend repo into src/generated/.
 *
 * The guide pages and the word generator show the words the game deals, so
 * they read the backend's own seed files rather than a copy kept by hand. As
 * with the contract (sync-contract.mjs), the backend copies stay the single
 * source of truth, these are build artifacts, and `--check` fails CI when
 * they diverge.
 *
 * Source resolution, in order:
 *   1. $WORDS_SOURCE        (a backend checkout's root; CI's sparse be-src)
 *   2. ../vckscribble-be    (sibling checkout, the dev case)
 *   3. ../be                (the sibling name sync-contract.mjs looks for)
 *   4. the GitHub contents API (FE cloned on its own; the repo is public)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEST = resolve(HERE, '../src/generated');
const FILES = ['packs.seed.ts', 'words.seed.ts'];
const SIBLINGS = [resolve(HERE, '../../vckscribble-be'), resolve(HERE, '../../be')];
const REPO = 'shabbir642/vckscribble-be';
const REF = 'main';
const remote = (file) => `https://api.github.com/repos/${REPO}/contents/src/db/${file}?ref=${REF}`;

// Fixed text only: a path, a time or a SHA here would make every --check fail.
const banner = (file) => `// AUTO-GENERATED — DO NOT EDIT.
// Source of truth: vckscribble-be/src/db/${file}
// Regenerate with: pnpm words:sync
`;

/** The seeds import the contract's types; here it sits right next to them. */
const CONTRACT_IMPORT = /(['"])\.\.\/contract\/index\.js\1/g;
const RELATIVE_IMPORT = /from\s+(['"])(\.{1,2}\/[^'"]*)\1/g;

const hasSeeds = (root) => FILES.every((f) => existsSync(join(root, 'src/db', f)));

async function readSeeds(root) {
  const bodies = {};
  for (const f of FILES) bodies[f] = await readFile(join(root, 'src/db', f), 'utf8');
  return bodies;
}

async function fetchSources() {
  const override = process.env.WORDS_SOURCE;
  if (override) {
    const root = resolve(override);
    // A typo must fail here, not quietly fall through to another source.
    if (!hasSeeds(root)) {
      throw new Error(`$WORDS_SOURCE=${override} has no src/db/{${FILES.join(',')}}`);
    }
    return { bodies: await readSeeds(root), from: root };
  }
  const sibling = SIBLINGS.find(hasSeeds);
  if (sibling) return { bodies: await readSeeds(sibling), from: sibling };

  // `||`, not `??`: CI passes a missing secret as an empty string.
  const token = process.env.CONTRACT_TOKEN || process.env.GITHUB_TOKEN;
  const bodies = {};
  for (const f of FILES) {
    const url = remote(f);
    const res = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.raw',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }).catch((e) => {
      throw new Error(`cannot reach ${url}: ${e.message}`);
    });
    if (!res.ok) {
      throw new Error(
        `fetch ${url} -> ${res.status}.\n` +
          (res.status === 403 || res.status === 429
            ? 'GitHub limits anonymous requests to 60 an hour. Set $GITHUB_TOKEN, ' +
              'or point $WORDS_SOURCE at a backend checkout.'
            : 'Clone the backend as a sibling ../vckscribble-be, or point $WORDS_SOURCE at a checkout.'),
      );
    }
    bodies[f] = await res.text();
  }
  return { bodies, from: `github.com/${REPO}@${REF}` };
}

/** Banner on top, and the contract import pointed at the vendored contract. */
function vendor(file, body) {
  let rewritten = 0;
  const out = body.replace(CONTRACT_IMPORT, (_m, q) => {
    rewritten++;
    return `${q}./contract${q}`;
  });
  if (!rewritten) {
    throw new Error(`${file} no longer imports '../contract/index.js'; update scripts/sync-words.mjs to match.`);
  }
  // Anything else relative would point at a file that is not vendored.
  for (const [, , path] of out.matchAll(RELATIVE_IMPORT)) {
    if (path !== './contract') {
      throw new Error(`${file} imports '${path}', which is not vendored; update scripts/sync-words.mjs to match.`);
    }
  }
  return banner(file) + out;
}

const check = process.argv.includes('--check');

let from;
const next = {};
try {
  const source = await fetchSources();
  from = source.from;
  for (const f of FILES) next[f] = vendor(f, source.bodies[f]);
} catch (e) {
  // A stack trace here is noise: every failure mode is a configuration
  // problem, and the message already says which one.
  console.error(`words: ${e.message}`);
  process.exit(1);
}

const stale = [];
for (const f of FILES) {
  const dest = join(DEST, f);
  const current = existsSync(dest) ? await readFile(dest, 'utf8') : null;
  if (current !== next[f]) stale.push(f);
}

if (!stale.length) {
  console.log(`words: up to date (${from})`);
  process.exit(0);
}
if (check) {
  console.error(
    `words: DRIFT — ${stale.map((f) => `src/generated/${f}`).join(' and ')} ` +
      `${stale.length > 1 ? 'differ' : 'differs'} from ${from}\n` +
      'Run `pnpm words:sync` and commit the result.',
  );
  process.exit(1);
}
await mkdir(DEST, { recursive: true });
for (const f of stale) await writeFile(join(DEST, f), next[f]);
console.log(`words: synced ${stale.join(', ')} from ${from}`);
