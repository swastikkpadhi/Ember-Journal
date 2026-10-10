# Ember Journal development context

Updated 10 October 2026 for the v2 backend and interface. The original single-file localStorage prototype is available at commit `8d532b2`; this document describes the current implementation.

## Product

A personal encrypted diary with writing, moods and energy, optional daily reflection, timeline/search, insights, favorites, and gentle progress. Six sections remain: Today, Timeline, Quests, Reflect, Insights, and Settings. Beige is the default appearance; a separate low-light mode is optional. Reflections use predefined questions and on-device arithmetic; no AI service is connected.

## Repository map

| File | Responsibility |
| --- | --- |
| `server.js` | Same-origin HTTP server, SQLite schema, authentication, sessions, rate limiting, ownership checks, encrypted vault persistence, password changes/deletion, public asset allowlist. |
| `index.html` | Minimal document, accessible roots, opening flourish, module/styles loading. |
| `app.js` | Application views, delegated events, account flow, in-memory unlock state, encrypted save queue, backup/import, recovery, locking, notifications. |
| `crypto.js` | Browser PBKDF2/HKDF derivation and AES-GCM encrypt/decrypt. Also used by crypto/HTTP tests through Node Web Crypto. |
| `domain.js` | State defaults/normalization, date arithmetic, entries/drafts, reflection saves/edits, streaks/shields, milestones/quests. |
| `questions.js` | Versioned 16-question content in five optional sections and daily free-writing prompts. |
| `styles.css` | Beige/sage/terracotta design tokens, responsive sidebar/bottom navigation, notebook, forms, animation, reduced motion, low-light mode. |
| `tests/*.test.js` | Domain and cryptography regressions, real HTTP privacy/authentication tests. |
| `package.json` | Node 24 runtime requirement; start, dev, and test commands. No external runtime dependencies. |
| `.env.example` | Local configuration; production requires HTTPS. Actual `.env` is ignored. |
| `Dockerfile`, `compose.yaml`, `Caddyfile` | Self-hosting with TLS proxy and durable SQLite volume. Not deployed in this workspace. |
| `README.md`, `SECURITY.md` | Usage, migration/deployment, and privacy boundary. |
| Four root SVGs | Retained illustrative previews from the original prototype. |

Run `npm start`, then open `http://127.0.0.1:3000/`. The app requires its backend; it is no longer a direct-open HTML/GitHub Pages application. Data lives in ignored `data/ember.sqlite`. Start with Node 24.13+ in the Node 24 line (verified here with 24.20.0).

## Privacy and authentication

The browser derives a root from the passphrase with PBKDF2-SHA-256/600,000 iterations and a per-account random salt. HKDF separates an authentication credential from the nonextractable AES-256-GCM diary key. Only the authentication credential is sent to the server; the server independently scrypt-hashes it. Password material and the diary key are never sent.

One account-owned encrypted vault contains all entries, questionnaire answers, preferences, and drafts. Its nonce changes on every save; authenticated additional data binds it to the account ID. The server knows email/account metadata, salts, credential hashes, timestamps, session records, and ciphertext. It cannot use the stored authentication credential hash as a diary decryption key. See `SECURITY.md` for trusted-browser/host assumptions; do not claim protection against compromised frontend delivery or an already unlocked device.

Cookie sessions are server-enforced, HttpOnly, SameSite=Strict, and Secure/`__Host-` in production, with a twelve-hour absolute lifetime. API mutations check the configured origin; authenticated mutations also check a session CSRF token. Ownership always comes from the session, not a submitted account ID. No raw diary or credential payloads are logged.

There is no server-held recovery key, passphrase-reset recovery, email verification/delivery, MFA, or OAuth. Email is a login identifier. Password rotation re-encrypts the whole vault, updates credentials atomically, and revokes existing sessions.

## Backend routes

| Method / route | Purpose |
| --- | --- |
| `GET /api/health` | Lightweight readiness response. |
| `POST /api/auth/challenge` | Return the account derivation salt; unknown accounts get a stable fake salt to reduce enumeration. |
| `POST /api/auth/register` | Create credentials and initial encrypted vault transactionally; issue session. |
| `POST /api/auth/login` | Verify derived credential; issue a fresh random session. |
| `GET /api/auth/session` | Return session identity and CSRF token, without unlocking content. |
| `POST /api/auth/logout` | Revoke the current session and clear cookie. |
| `GET /api/vault` | Read only the current account's ciphertext and revision. |
| `PUT /api/vault` | Compare-and-swap encrypted update; return 409 for a stale revision. |
| `POST /api/auth/password` | Reauthenticate, rotate credentials/re-encrypted vault, revoke sessions. |
| `DELETE /api/auth/account` | Reauthenticate and cascade-delete account/vault/sessions. |

SQLite tables are `users`, `vaults`, `sessions`, and `meta`. WAL, foreign keys, secure deletion, and a busy timeout are enabled. The backend is intended for one persistent instance. Horizontal scaling needs a transactional shared database and distributed limits. TRUST_PROXY is opt-in and requires a private backend behind a trusted proxy; the supplied Caddy arrangement satisfies that networking pattern.

## Frontend execution and saving

The module keeps the current account, CSRF token, key, unlocked state, and revision in memory. A remembered cookie does not unlock the diary after reload: the passphrase is required again. Values rendered from journals/imports/account data are HTML-escaped; there are no inline handlers or inline styles. CSP allows only same-origin resources, with no external fonts or trackers.

Event delegation handles buttons/forms/input. Most view changes rebuild the content, but input is mirrored into domain drafts first, so navigating does not discard writing. New-entry drafts, saved-entry edit drafts, and questionnaire drafts are part of the encrypted vault. Edits replace their original entry only when explicitly saved.

A generation counter and serialized save loop encrypt snapshots after a short debounce. It keeps saving if more changes arrive during a request. A per-tab, account-scoped encrypted recovery copy is retained when saving fails; it has no unlock key. Only a matching server base revision is automatically recovered. Older conflicting copies remain separate for protected download. Recovery copies from other or closed tabs are offered for download rather than automatically merged. Stale server writes never silently overwrite a newer vault.

Manual lock removes decrypted state/key from memory after protecting pending changes. Idle lock runs after fifteen minutes of inactivity; failures to both save and retain a local encrypted recovery copy are surfaced instead of discarding changes. Sign-out revokes the backend session. The page reports unsaved changes before unloading.

## Domain schema and feature rules

State schema 2 retains `j`, `e`, `xp`, `best`, `b`, `fz`, `shieldEarned`, `uf`, `cl`, and `favorites`, and adds `preferences` and `drafts`. Defaults and normalization are centralized in `domain.js` and run after every unlock/import. Duplicate imported IDs are reassigned. Invalid legacy records are filtered. No automatic import or erasure of prototype localStorage data occurs.

An entry has `id`, `title`, `t`, `j`, `m` (mood 1–5), `en` (energy 0–100), `g` (tags), `d` (local date), `ts`, `q`, `x`, `kind`, `answers`, and `questionsVersion`, plus `editedAt` after edits. IDs use `crypto.randomUUID()`. Zero energy survives save/normalization/editing. Questionnaire entries store both readable text and answers keyed by question ID.

Preferences contain name, avatar, light/dark mode, writing font, reminder configuration, and last reminder. Drafts include free writing, a current saved-entry edit, and the questionnaire's original date, answers, mood, energy, section, and optional original-entry ID for editing. Imported settings/drafts are normalized, while the import interface merges entries rather than replacing current preferences/drafts.

Weeks begin Monday. Streaks use unique local entry dates plus shield-covered dates; yesterday's streak still counts before today's first entry. A full entry earns 10 XP, a quick log 5; the first daily entry adds up to 10 streak XP. Level is floor(XP/100)+1. One shield is earned after a seven-day milestone and can cover exactly one missed day. Original XP/best streak/badges are retained when an entry is deleted.

Quest rewards are 40 XP for five entries, 40 for 150 written words, and 30 for three quick mood logs. Claims check completion and idempotency in domain logic. Reflection question titles do not count toward the writing-word goal. Reflection edits retain entry identity and XP.

Timeline supports a mood calendar, date selection, text/tag search, and journal filtering. Insights compute fourteen daily mood averages, weekly summaries, and tag deviations from the overall mood average with at least two observations and a 0.2 difference. They are descriptive associations, not diagnoses. Favorites are cleaned when entries are deleted.

Questionnaire sections: arriving, nourishing moments, people/connections, harder experiences, and closing with kindness. All sixteen answers and all sections are optional. Partial answers save as a reflection; blank questions do not block it. The content is not a clinical assessment and makes no diagnostic or risk-score claims.

Protected backups include account ID, salt, and encrypted vault. A backup may be imported into another account with its original passphrase. Readable exports are explicitly confirmed and include decrypted drafts/preferences. Existing prototype exports with `entries` are supported. Import deduplicates moments and preserves current entries.

Reminders work only while unlocked/open, with granted notification permission; notifications contain no journal text. There is no service worker or background reminder scheduler.

## Verification and remaining boundaries

`npm test` covers crypto round-trips and tampering, account separation, actual HTTP requests, encrypted database contents, server restart persistence, CSRF/origin rejection, stale writes, passphrase rotation/session revocation, account deletion, cookies/CSP, drafts, reflection editing, quest claims, and legacy normalization. Tests create and remove disposable temporary databases.

Verification on October 10, 2026: all ten automated tests passed on Node 24.20.0. Syntax checks and Git whitespace checks passed. Browser checks additionally exercised account creation, zero-energy entry editing, draft retention between sections, partial questionnaire saving, locking/unlocking, persistence after a server restart, timeline search, all six navigation sections, light/dark preferences, and a 390-pixel phone layout without horizontal overflow. An encrypted backup was downloaded and restored without duplicating the two existing entries; no browser console errors were recorded. The disposable preview account was removed after checking, and the owned preview server was stopped. Docker/Caddy deployment has not been executed.

Hosting/domain provisioning is separate from these repository changes. Test Docker/Caddy on the chosen host and configure backup retention before public use. The encryption/authentication implementation is not independently audited. More product work could include verified email ownership, MFA, a separately designed recovery-key scheme, or multi-instance persistence; do not add password-reset decryption through a server-held key without revisiting the privacy requirement.
