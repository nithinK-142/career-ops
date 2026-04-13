@AGENTS.md

<!-- Add Claude Code-specific guidance here only when it has no AGENTS.md counterpart. -->


## Outreach pipeline (fork addition)

- `outreach.mjs` — outreach pipeline orchestrator
- `outreach-query-gen.mjs` — generates search queries from profile
- `outreach-db.mjs` — SQLite lead/tracking database
- `send-outreach.mjs` — Playwright LinkedIn connection/DM sender
- `email-discover.mjs` — email pattern discovery and SMTP verification
- `send-email.mjs` — Gmail SMTP outreach sender
- `gmail-sync.mjs` — Gmail reply sync input for `reply-watch.mjs`
