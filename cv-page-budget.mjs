#!/usr/bin/env node
/**
 * cv-page-budget.mjs — per-candidate default page budget for generated CVs
 *
 * Users declare a `cv:` block in config/profile.yml:
 *
 *   cv:
 *     max_pages: 1
 *     strict_pages: true
 *
 * generate-pdf.mjs reads this as the default for --max-pages/--strict-pages
 * when the CLI invocation doesn't pass them explicitly — an explicit CLI flag
 * always wins over the profile default. A profile with no `cv:` block (or no
 * recognized keys in it) leaves generate-pdf.mjs's own hardcoded defaults
 * (2 pages, warning-only) untouched, so this is opt-in per candidate.
 *
 * Pure + dependency-light (js-yaml only), mirrors theme-style.mjs so it's
 * unit-testable without Playwright.
 */
import { readFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';

/**
 * Read the recognized `cv:` page-budget keys from a profile file.
 * Missing file / absent block / bad YAML / unrecognized keys → {}.
 * @param {string} [profilePath]
 * @returns {{maxPages?: number, strictPages?: boolean}}
 */
export function readPageBudget(profilePath = 'config/profile.yml') {
  try {
    if (!existsSync(profilePath)) return {};
    const raw = yaml.load(readFileSync(profilePath, 'utf-8')) || {};
    return pageBudgetFrom(raw?.cv);
  } catch {
    return {};
  }
}

/**
 * Map a parsed `cv:` object to { maxPages, strictPages }, keeping only
 * recognized, validly-typed keys. Exported for tests.
 * @param {unknown} cv
 * @returns {{maxPages?: number, strictPages?: boolean}}
 */
export function pageBudgetFrom(cv) {
  const out = {};
  if (!cv || typeof cv !== 'object' || Array.isArray(cv)) return out;
  const { max_pages, strict_pages } = cv;
  if (Number.isInteger(max_pages) && max_pages >= 1) out.maxPages = max_pages;
  if (typeof strict_pages === 'boolean') out.strictPages = strict_pages;
  return out;
}
