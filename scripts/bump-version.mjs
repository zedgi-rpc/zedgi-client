#!/usr/bin/env node
/**
 * Bump @zedgi/zedgi-client to the next publishable version.
 *
 * Reads the latest version published to npm, computes the next one with the
 * capped-digit scheme (each of major.minor.patch is 0–9, carrying on overflow:
 * 1.0.0 → 1.0.1 → … → 1.0.9 → 1.1.0 → … → 1.9.9 → 2.0.0), then writes it to the
 * two spots that must stay in sync:
 *   - package.json            "version"
 *   - src/index.ts            _ZEDGI_CLIENT_VERSION
 *
 * Run before publishing so `npm publish` never fails on an existing version:
 *   node scripts/bump-version.mjs        # or: npm run bump
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = join(pkgDir, 'package.json');
const indexPath = join(pkgDir, 'src', 'index.ts');

/** "a.b.c" → next version, capping each component at 9 and carrying over. */
const nextVersion = (version) => {
  let [a, b, c] = version.split('.').map(Number);
  if ([a, b, c].some((n) => !Number.isInteger(n))) {
    throw new Error(`Cannot parse version "${version}" as major.minor.patch`);
  }
  c += 1;
  if (c > 9) { c = 0; b += 1; }
  if (b > 9) { b = 0; a += 1; }
  return `${a}.${b}.${c}`;
};

const cmp = (x, y) => {
  const xs = x.split('.').map(Number);
  const ys = y.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (xs[i] !== ys[i]) return xs[i] - ys[i];
  }
  return 0;
};

/** Highest version published to npm, or null if the package has never been
 * published. Takes the max of all versions rather than the `latest` dist-tag,
 * which can lag behind the highest published version. */
const publishedVersion = (name) => {
  let raw;
  try {
    raw = execSync(`npm view ${name} versions --json`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return null; // 404 — not published yet
  }
  if (!raw) return null;
  // `--json` yields an array, or a bare string when only one version exists.
  let list;
  try {
    list = JSON.parse(raw);
  } catch {
    return null;
  }
  const versions = (Array.isArray(list) ? list : [list]).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
  return versions.length ? versions.sort(cmp).at(-1) : null;
};

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const local = pkg.version;
const published = publishedVersion(pkg.name);

// First publish: keep whatever the files already declare. Otherwise bump past
// the published version, but never below a locally-staged-ahead version.
let target;
if (!published) {
  target = local;
} else {
  const bumped = nextVersion(published);
  target = cmp(local, bumped) > 0 ? local : bumped;
}

pkg.version = target;
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

const index = readFileSync(indexPath, 'utf8');
const versionRe = /(_ZEDGI_CLIENT_VERSION\s*=\s*)['"][^'"]*['"]/;
if (!versionRe.test(index)) {
  // Genuinely missing — distinct from "value already equals target" (a no-op).
  throw new Error(`Could not find _ZEDGI_CLIENT_VERSION in ${indexPath}`);
}
writeFileSync(indexPath, index.replace(versionRe, `$1'${target}'`));

console.log(`${pkg.name}: ${published ?? '(unpublished)'} → ${target}`);
