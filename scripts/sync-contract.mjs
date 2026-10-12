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
const REMOTE =
  'https://raw.githubusercontent.com/shabbir642/vckscribble-be/main/src/contract/index.ts';

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
  const res = await fetch(REMOTE);
  if (!res.ok) throw new Error(`fetch ${REMOTE} -> ${res.status}`);
  return { body: await res.text(), from: REMOTE };
}

const check = process.argv.includes('--check');
const { body, from } = await fetchSource();
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
