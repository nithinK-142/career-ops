// tests/cv-page-budget.test.mjs — config/profile.yml `cv:` block sets a
// candidate's own default --max-pages/--strict-pages for generate-pdf.mjs
// (mirrors tests/theme-style.test.mjs's shape for the sibling `style:` block).
import { spawnSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { pass, fail, ROOT, NODE } from './helpers.mjs';
import { pageBudgetFrom, readPageBudget } from '../cv-page-budget.mjs';

console.log('\ncv-page-budget.mjs — profile-driven default page budget');

// --- pageBudgetFrom: pure mapping, only recognized/valid keys survive ------

const cases = [
  ['undefined cv block', undefined, {}],
  ['null cv block', null, {}],
  ['non-object cv block', 'nope', {}],
  ['array cv block', ['nope'], {}],
  ['empty cv block', {}, {}],
  ['max_pages only', { max_pages: 1 }, { maxPages: 1 }],
  ['strict_pages only', { strict_pages: true }, { strictPages: true }],
  ['both keys', { max_pages: 1, strict_pages: true }, { maxPages: 1, strictPages: true }],
  ['strict_pages: false is a recognized explicit value', { strict_pages: false }, { strictPages: false }],
  ['max_pages: 0 is rejected (not >= 1)', { max_pages: 0 }, {}],
  ['max_pages: -1 is rejected', { max_pages: -1 }, {}],
  ['max_pages: 1.5 is rejected (not an integer)', { max_pages: 1.5 }, {}],
  ['max_pages as a string is rejected (no coercion)', { max_pages: '1' }, {}],
  ['strict_pages as a string is rejected (no coercion)', { strict_pages: 'true' }, {}],
  ['unrecognized keys are ignored', { color: 'blue' }, {}],
];

for (const [label, input, expected] of cases) {
  const actual = pageBudgetFrom(input);
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass(`pageBudgetFrom: ${label}`);
  else fail(`pageBudgetFrom: ${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- readPageBudget: file I/O + YAML parsing, fails closed to {} ----------

const outputRoot = join(ROOT, 'output');
mkdirSync(outputRoot, { recursive: true });
const sandbox = mkdtempSync(join(outputRoot, 'cv-page-budget-test-'));

try {
  const missingPath = join(sandbox, 'does-not-exist.yml');
  check('readPageBudget: missing file returns {}', readPageBudget(missingPath), {});

  const noCvBlock = join(sandbox, 'no-cv-block.yml');
  writeFileSync(noCvBlock, 'candidate:\n  full_name: "Jane Smith"\n', 'utf-8');
  check('readPageBudget: profile with no cv: block returns {}', readPageBudget(noCvBlock), {});

  const withCvBlock = join(sandbox, 'with-cv-block.yml');
  writeFileSync(withCvBlock, 'cv:\n  max_pages: 1\n  strict_pages: true\n', 'utf-8');
  check('readPageBudget: profile with cv: block reads both keys',
    readPageBudget(withCvBlock), { maxPages: 1, strictPages: true });

  const malformed = join(sandbox, 'malformed.yml');
  writeFileSync(malformed, 'cv:\n  max_pages: [1\n', 'utf-8');
  check('readPageBudget: malformed YAML returns {} instead of throwing', readPageBudget(malformed), {});
} finally {
  // Only the readPageBudget fixtures above are cleaned up here; the
  // generate-pdf.mjs integration sandbox below manages its own lifecycle.
  rmSync(sandbox, { recursive: true, force: true });
}

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass(label);
  else fail(`${label} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// --- Integration: generate-pdf.mjs actually applies the profile default, ---
// --- and an explicit CLI flag still overrides it ---------------------------
// Reuses the same isolated-sandbox + stub-Chromium approach as
// tests/generate-pdf-page-budget.test.mjs so this file can run standalone
// without depending on that file's sandbox.

const pdfSandbox = mkdtempSync(join(outputRoot, 'cv-page-budget-pdf-test-'));
const script = join(pdfSandbox, 'generate-pdf.mjs');
const twoPageInput = join(pdfSandbox, 'two-pages.html');
const manifest = join(pdfSandbox, 'data', 'pdf-index.tsv');
mkdirSync(join(pdfSandbox, 'data'), { recursive: true });
writeFileSync(manifest, '', 'utf-8');
mkdirSync(join(pdfSandbox, 'config'), { recursive: true });
const playwrightStub = join(pdfSandbox, 'node_modules', 'playwright');

copyFileSync(join(ROOT, 'generate-pdf.mjs'), script);
copyFileSync(join(ROOT, 'theme-style.mjs'), join(pdfSandbox, 'theme-style.mjs'));
copyFileSync(join(ROOT, 'cv-page-budget.mjs'), join(pdfSandbox, 'cv-page-budget.mjs'));
mkdirSync(playwrightStub, { recursive: true });
writeFileSync(join(playwrightStub, 'package.json'), JSON.stringify({
  name: 'playwright',
  type: 'module',
  exports: './index.js',
}), 'utf-8');
// Always renders a 2-page PDF, regardless of input — this test is only about
// which page budget generate-pdf.mjs decides to enforce, not about rendering.
writeFileSync(join(playwrightStub, 'index.js'), `
const twoPagePdf = Buffer.from(\`%PDF-1.7
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R >>
endobj
%%EOF\`, 'latin1');

export const chromium = {
  async launch() {
    return {
      async newPage() {
        return {
          async goto() {},
          async evaluate() {},
          async pdf() { return twoPagePdf; },
        };
      },
      async close() {},
    };
  },
};
`, 'utf-8');
writeFileSync(twoPageInput, `<!doctype html><html><body><main>Only page</main></body></html>\n`, 'utf-8');

function runPdf(args) {
  const result = spawnSync(NODE, [script, ...args], {
    cwd: pdfSandbox,
    encoding: 'utf-8',
    timeout: 30_000,
  });
  return { ...result, output: `${result.stdout || ''}${result.stderr || ''}` };
}

function writeProfile(cv) {
  writeFileSync(join(pdfSandbox, 'config', 'profile.yml'), `cv:\n${
    Object.entries(cv).map(([k, v]) => `  ${k}: ${v}`).join('\n')
  }\n`, 'utf-8');
}

try {
  // No profile.yml at all: unaffected, existing hardcoded defaults apply.
  const noProfileOut = join(pdfSandbox, 'no-profile.pdf');
  const noProfile = runPdf([twoPageInput, noProfileOut]);
  if (noProfile.status === 0 && noProfile.output.includes('📐 Page budget: 2 (warning only)')) {
    pass('generate-pdf: no config/profile.yml leaves the hardcoded default (2, warning-only) untouched');
  } else {
    fail(`generate-pdf: missing-profile default regressed: ${noProfile.output.trim()}`);
  }

  // Profile sets max_pages: 1 + strict_pages: true, no CLI flags given: the
  // 2-page stub PDF must now be strictly rejected using the profile's budget.
  writeProfile({ max_pages: 1, strict_pages: true });
  const profileOnlyOut = join(pdfSandbox, 'profile-only.pdf');
  const profileOnly = runPdf([twoPageInput, profileOnlyOut]);
  if (
    profileOnly.status !== 0 &&
    profileOnly.output.includes('📐 Page budget: 1 (strict)') &&
    profileOnly.output.includes('CV is 2 pages') &&
    !profileOnly.output.includes('✅ PDF generated')
  ) {
    pass('generate-pdf: config/profile.yml cv.max_pages/strict_pages apply with no CLI flags');
  } else {
    fail(`generate-pdf: profile-driven default did not apply: ${profileOnly.output.trim()}`);
  }

  // Same profile (max_pages: 1, strict_pages: true), but an explicit
  // --max-pages=2 on the CLI must win for that key specifically — the profile
  // default only fills in keys the invocation didn't specify, independently
  // per key (strict_pages still comes from the profile here, which is
  // correct: 2 pages within a budget of 2 succeeds regardless of strictness).
  const cliOverrideOut = join(pdfSandbox, 'cli-override.pdf');
  const cliOverride = runPdf([twoPageInput, cliOverrideOut, '--max-pages=2']);
  if (
    cliOverride.status === 0 &&
    existsSync(cliOverrideOut) &&
    cliOverride.output.includes('📐 Page budget: 2') &&
    cliOverride.output.includes('✅ PDF generated')
  ) {
    pass('generate-pdf: an explicit --max-pages CLI flag overrides the profile default for that key');
  } else {
    fail(`generate-pdf: CLI override lost to the profile default: ${cliOverride.output.trim()}`);
  }

  // Explicit --max-pages=2 AND --strict-pages=false is not expressible (it's
  // a bare flag), so cover the other direction: both flags explicit means the
  // profile is not consulted for either key at all.
  const bothExplicitOut = join(pdfSandbox, 'both-explicit.pdf');
  const bothExplicit = runPdf([twoPageInput, bothExplicitOut, '--max-pages=2', '--strict-pages']);
  if (
    bothExplicit.status === 0 &&
    existsSync(bothExplicitOut) &&
    bothExplicit.output.includes('📐 Page budget: 2 (strict)') &&
    bothExplicit.output.includes('✅ PDF generated')
  ) {
    pass('generate-pdf: both flags explicit bypasses the profile default entirely');
  } else {
    fail(`generate-pdf: fully-explicit CLI flags did not bypass the profile: ${bothExplicit.output.trim()}`);
  }

  // Explicit --max-pages=1 without --strict-pages: the profile's strict_pages
  // must still fill in (only maxPages was given on the CLI), so this stays a
  // hard rejection rather than silently downgrading to warning-only.
  const partialOverrideOut = join(pdfSandbox, 'partial-override.pdf');
  const partialOverride = runPdf([twoPageInput, partialOverrideOut, '--max-pages=1']);
  if (
    partialOverride.status !== 0 &&
    partialOverride.output.includes('📐 Page budget: 1 (strict)') &&
    !partialOverride.output.includes('✅ PDF generated')
  ) {
    pass('generate-pdf: profile strict_pages fills in when only --max-pages is given explicitly');
  } else {
    fail(`generate-pdf: partial CLI override did not blend with the profile default: ${partialOverride.output.trim()}`);
  }
} finally {
  rmSync(pdfSandbox, { recursive: true, force: true });
}
