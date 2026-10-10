# Ember Journal

A warm, private diary with encrypted entries, mood check-ins, and gentle daily reflection. The interface uses beige paper tones, sage accents, a notebook-inspired editor, and subtle opening animations that respect reduced-motion preferences.

## Run locally

Install Node.js 24.13 or later within the Node 24 release line, then run from this folder:

```powershell
npm start
```

Open **http://127.0.0.1:3000/** and create an account. No package installation or build step is required: the backend uses Node's HTTP, crypto, and SQLite modules. `node:sqlite` availability/stability depends on the Node release; this project is tested against Node 24.20.0.

The default database is `data/ember.sqlite`. It persists across server restarts and is ignored by Git. Both the frontend and API are served by the backend; opening `index.html` directly or publishing only to GitHub Pages no longer runs the app.

Optional configuration: copy `.env.example` to `.env`. `npm start` loads that file when present. `npm run dev` restarts the backend when source files change. Preserve the same host/port during browser testing.

## What is included

- Server-verified registration/sign-in, protected session cookies, sign-out, manual/inactivity locking, passphrase changes, and account deletion.
- End-to-end encrypted diary storage: the browser encrypts entries, questionnaire answers, preferences, and unfinished writing before saving them.
- Writing and quick mood logs with energy, activities, journal selection, editing, and favorites.
- A searchable timeline, mood calendar, personal insights, optional quests, badges, streaks, and a one-day milestone shield.
- A 16-question daily reflection in five sections: arriving, nourishing moments, connections, difficult experiences, and closing with kindness. Every question and section can be skipped; partial reflections can be saved.
- Encrypted draft recovery, protected backups, readable exports, and backup/older-export import with duplicate detection.
- Browser reminders while the page is open and unlocked; no journal text in notifications.
- Responsive navigation, keyboard focus states, low-light appearance, and reduced-motion support.

The questionnaire uses open-ended, nonjudgmental language and themes of grounding, connection, values, and self-kindness. It is a reflection exercise, not a clinical assessment, diagnosis, or therapy. The content takes inspiration from the [WHO guide Doing What Matters in Times of Stress](https://www.who.int/publications/i/item/9789240003927); it is not a validated clinical instrument or an endorsement by WHO.

## Privacy

Your passphrase is not sent to the backend. Separate browser-derived secrets handle account verification and AES-GCM diary encryption. The backend stores ciphertext and account metadata, including your email address, salts, and a hashed authentication credential. It does not store the diary unlock key.

**Keep your passphrase safe. A forgotten passphrase cannot be reset to recover your diary.** Make encrypted backups. Someone using your unlocked diary or controlling your device can read your writing; see [SECURITY.md](SECURITY.md) for the complete boundary and deployment assumptions.

Email is currently a login identifier; this self-hosted version does not send verification or recovery emails. No AI provider, advertising scripts, analytics, or external fonts are connected.

## Existing prototype diaries

Older `ember` / `ember_journal_*` browser records are left untouched. They are not silently uploaded, reassigned to a new account, or deleted. Export them using the older prototype, then import that JSON in **Settings → Restore a backup or import an older diary**.

If you need the older interface to export, the original `index.html` is in commit `8d532b2`. Open a separate copy in the same browser/origin used for the old diary. Local browser storage belongs to its origin; the new localhost server cannot read a diary previously saved under a different host or a `file:` URL.

## Self-host with HTTPS

The supplied Dockerfile and Compose configuration run one app instance behind Caddy, which terminates HTTPS. Point a real domain at your host, install Docker with Compose, and set `EMBER_DOMAIN` in `.env`, for example:

```text
EMBER_DOMAIN=journal.example.com
```

Then run:

```powershell
docker compose up -d --build
```

This publishes Caddy on ports 80/443 and keeps the app backend private. `diary_data` persists the SQLite database; `proxy_data` holds TLS state. **Do not remove these volumes when updating the app.** Only enable proxy trust when the backend is inaccessible directly.

For a different HTTPS proxy, set `NODE_ENV=production`, `APP_ORIGIN=https://your-domain`, `HOST`, `PORT`, and a persistent `DATA_DIR`. Set the forwarded request Host to the configured public host. The app rejects production configuration without HTTPS and sets Secure session cookies. Loopback development HTTP is not a public deployment configuration.

Back up the SQLite database with SQLite's online backup facility, or stop the app while copying its complete data directory. Copying only the main database during a running WAL-mode session can miss updates. Protect database backups: they contain account metadata as well as encrypted vaults. The supplied deployment needs a persistent host, not a stateless function filesystem.

Hosting has not been provisioned by this repository change. The Docker setup requires your domain/server and has not been run in this workspace.

## Verification and development

```powershell
npm test
```

Tests cover encryption/tampering, HTTP account isolation, CSRF and origin checks, conflicts, persistence after restart, passphrase changes, account deletion, draft preservation, reflection editing, and quest claims. The tests use disposable temporary databases and never existing diaries.

See [DEVELOPMENT_CONTEXT.md](DEVELOPMENT_CONTEXT.md) for the code map and [SECURITY.md](SECURITY.md) for the encryption/authentication design. The four root SVGs are retained illustrations of the older prototype, not screenshots of this interface.
