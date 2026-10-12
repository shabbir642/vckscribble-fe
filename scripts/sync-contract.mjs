#!/usr/bin/env node
/**
 * Vendors the socket contract from the backend repo into src/generated/.
 *
 * Splitting FE and BE into separate repos cost us the shared workspace package
 * that previously made protocol drift impossible. This script is the
 * replacement: the BE copy stays the single source of truth, this one is a
 * build artifact, and `--check` fails CI when they diverge.
 *
 * Source resolution, in order:
 *   1. $CONTRACT_SOURCE   (path or URL — overrides everything)
 *   2. ../be/src/contract/index.ts   (sibling checkout, the dev case)
 *   3. the GitHub raw URL below      (CI, or FE cloned on its own)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEST = resolve(HERE, '../src/generated/contract.ts');
const SIBLING = resolve(HERE, '../../be/src/contract/index.ts');
const REPO = 'shabbir642/vckscribble-be';
const PATH = 'src/contract/index.ts';
const REF = 'main';
/**
 * The GitHub contents API rather than raw.githubusercontent.com: the backend
 * repo is private, and raw.* has no way to present a token. With
 * $CONTRACT_TOKEN this works for private repos; without one it 404s, which is
 * why CI checks the backend out as a sibling instead (see .github/workflows).
 */
const REMOTE = `https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${REF}`;

const BANNER = `// AUTO-GENERATED — DO NOT EDIT.
// Source of truth: vckscribble-be/src/contract/index.ts
// Regenerate with: pnpm contract:sync
`;

async function fetchSource() {
  const override = process.env.CONTRACT_SOURCE;
  if (override) {
    return override.startsWith('http')
      ? { body: await (await fetch(override)).text(), from: override }
      : { body: await readFile(override, 'utf8'), from: override };
  }
  if (existsSync(SIBLING)) {
    return { body: await readFile(SIBLING, 'utf8'), from: SIBLING };
  }
  const token = process.env.CONTRACT_TOKEN ?? process.env.GITHUB_TOKEN;
  const res = await fetch(REMOTE, {
    headers: {
      Accept: 'application/vnd.github.raw',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }).catch((e) => {
    throw new Error(`cannot reach ${REMOTE}: ${e.message}`);
  });
  if (!res.ok) {
    throw new Error(
      `fetch ${REMOTE} -> ${res.status}.\n` +
        (res.status === 404 && !token
          ? `${REPO} is private. Set $CONTRACT_TOKEN, or clone it as a sibling ../be, ` +
            `or point $CONTRACT_SOURCE at a local copy.`
          : 'Check $CONTRACT_TOKEN scope.'),
    );
  }
  return { body: await res.text(), from: REMOTE };
}

const check = process.argv.includes('--check');

let body, from;
try {
  ({ body, from } = await fetchSource());
} catch (e) {
  // A stack trace here is noise: every failure mode is a configuration
  // problem, and the message already says which one.
  console.error(`contract: ${e.message}`);
  process.exit(1);
}
const next = BANNER + body;
const current = existsSync(DEST) ? await readFile(DEST, 'utf8') : null;

if (current === next) {
  console.log(`contract: up to date (${from})`);
  process.exit(0);
}
if (check) {
  console.error(
    `contract: DRIFT — src/generated/contract.ts differs from ${from}\n` +
      `Run \`pnpm contract:sync\` and commit the result.`,
  );
  process.exit(1);
}
await mkdir(dirname(DEST), { recursive: true });
await writeFile(DEST, next);
console.log(`contract: synced from ${from}`);
