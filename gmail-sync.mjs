#!/usr/bin/env node
/**
 * gmail-sync.mjs — Gmail scanner input for the reply-watch.mjs pipeline (#1583).
 *
 * docs/SCRIPTS.md documents reply-watch.mjs's classification pipeline as
 * reading data/reply-candidates.json, with "the only planned way to populate
 * that file is a Gmail scanner (#1583, unbuilt, requires OAuth inbox-read
 * access)" — paste-reply.mjs was built as the manual/no-Gmail fallback in the
 * meantime. This script is #1583: it scans the inbox over IMAP (an app
 * password, not full OAuth) and appends normalized candidates in the exact
 * shape reply-watch.mjs/paste-reply.mjs expect. It does NOT classify replies
 * or touch data/applications.md — that stays reply-watch.mjs's job, reusing
 * its mature matching (reply-matcher.mjs) instead of a bespoke classifier.
 *
 * One-time setup: Gmail Settings -> Forwarding and POP/IMAP -> Enable IMAP.
 * Uses the same GMAIL_APP_PASSWORD env var (or config/outreach.yml
 * email.app_password) as send-email.mjs.
 *
 * Run: node gmail-sync.mjs                fetch + append new candidates
 *      node gmail-sync.mjs --dry-run      fetch only, don't append or advance state
 *      node gmail-sync.mjs --lookback 90  override lookback_days (first run only)
 *
 * Then: node reply-watch.mjs  to classify the new candidates and review
 * suggested tracker updates.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';
import yaml from 'js-yaml';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { appendCandidate } from './paste-reply.mjs';

dns.setDefaultResultOrder('ipv4first');

const CAREER_OPS = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(CAREER_OPS, 'data/gmail-sync-state.json');
const CANDIDATES_PATH = process.env.CAREER_OPS_REPLY_CANDIDATES
  || join(CAREER_OPS, 'data/reply-candidates.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const lookbackIdx = args.indexOf('--lookback');
const lookbackOverride = lookbackIdx !== -1 ? parseInt(args[lookbackIdx + 1], 10) : null;

function loadConfig() {
  const outreachPath = join(CAREER_OPS, 'config/outreach.yml');
  const profilePath = join(CAREER_OPS, 'config/profile.yml');
  if (!existsSync(outreachPath) || !existsSync(profilePath)) {
    throw new Error('config/outreach.yml or config/profile.yml not found. Run setup first.');
  }
  const outreach = yaml.load(readFileSync(outreachPath, 'utf-8'));
  const profile = yaml.load(readFileSync(profilePath, 'utf-8'));
  return { outreach, profile };
}

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

function saveState(state) {
  if (dryRun) return;
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

async function main() {
  const { outreach, profile } = loadConfig();
  const emailConfig = outreach.email || {};
  const gmailSyncConfig = outreach.gmail_sync || {};
  const user = emailConfig.sender_email || profile.candidate?.email;
  const pass = process.env.GMAIL_APP_PASSWORD || emailConfig.app_password;

  if (!user || !pass) {
    console.error('Missing Gmail credentials. Set GMAIL_APP_PASSWORD env var (or config/outreach.yml email.app_password) and config/outreach.yml email.sender_email / profile.yml candidate.email.');
    process.exit(1);
  }

  const lookbackDays = lookbackOverride ?? gmailSyncConfig.lookback_days ?? 60;
  const state = loadState();

  const client = new ImapFlow({
    host: gmailSyncConfig.imap_host || 'imap.gmail.com',
    port: gmailSyncConfig.imap_port || 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });

  const newCandidates = [];
  let checked = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uidValidity = client.mailbox.uidValidity.toString();
      const priorState = state.INBOX && state.INBOX.uidValidity === uidValidity ? state.INBOX : null;

      const searchCriteria = priorState && priorState.lastUid
        ? { uid: `${priorState.lastUid + 1}:*` }
        : { since: new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000) };

      let maxUid = priorState?.lastUid || 0;

      for await (const msg of client.fetch(searchCriteria, { envelope: true, source: true, uid: true })) {
        checked += 1;
        if (msg.uid > maxUid) maxUid = msg.uid;

        const from = msg.envelope?.from?.[0];
        const fromAddress = from?.address ? `${from.name ? `${from.name} <${from.address}>` : from.address}` : '';
        const subject = msg.envelope?.subject || '';

        let bodySnippet = '';
        try {
          const parsed = await simpleParser(msg.source);
          bodySnippet = (parsed.text || parsed.html || '').trim();
        } catch {
          // no body available — subject-only candidate is still useful to reply-matcher.mjs
        }

        newCandidates.push({
          message_id: msg.envelope?.messageId || `gmail-uid-${msg.uid}`,
          from: fromAddress,
          subject,
          body_snippet: bodySnippet,
          signal: null,
        });
      }

      if (!dryRun) {
        for (const candidate of newCandidates) {
          appendCandidate(candidate, CANDIDATES_PATH);
        }
      }

      saveState({ ...state, INBOX: { uidValidity, lastUid: maxUid } });
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  console.log(`Checked ${checked} new message(s), appended ${dryRun ? 0 : newCandidates.length} candidate(s) to ${CANDIDATES_PATH}${dryRun ? ' (dry run — nothing written)' : ''}.`);
  if (!dryRun && newCandidates.length > 0) {
    console.log('Next: run `node reply-watch.mjs` to classify them and review suggested tracker updates.');
  }
}

main();
