# Diary privacy and security

Ember separates account authentication from diary encryption. The implementation protects diary content from other accounts and from someone reading the stored database, assuming a trusted browser/application and a strong passphrase. It has not received an independent security audit.

## Encryption and authentication

- A random 16-byte salt and PBKDF2-SHA-256 with 600,000 iterations derive password material in the browser.
- HKDF-SHA-256 separates that material into an authentication credential and a nonextractable AES-256-GCM encryption key using distinct labels.
- Only the derived authentication credential is sent to the backend, over HTTPS in production. The original passphrase, root material, and diary encryption key are not sent.
- The backend hashes that credential using scrypt (`N=131072`, `r=8`, `p=1`) and a separate random salt. It compares derived hashes in constant time. The credential is password-equivalent for authentication, so proxy and application logs must never capture it.
- Entries, questionnaire answers, preferences, ongoing writing, and edit drafts are encrypted together. Each save uses a fresh 12-byte nonce and binds the ciphertext to the account ID with AES-GCM additional authenticated data. Tampering, the wrong key, or a different account ID fails decryption.
- The encryption key exists only in browser memory while unlocked. Manual lock, successful sign-out, or closing/reloading the page requires the passphrase again. An inactivity timer attempts to save and lock after 15 minutes. If neither server nor encrypted local recovery storage is available, it keeps the diary open and reports the failure instead of discarding unsaved writing.

## Server boundary

SQLite stores email addresses, salts, authentication hashes, timestamps, session records, and encrypted vaults. Metadata is not end-to-end encrypted. No diary text is available to server-side analytics or logging.

Every vault read/write derives ownership from the authenticated server session. It does not accept a client-supplied owner ID. Password changes and account deletion require the current authentication credential again. Password changes atomically replace the encrypted vault and credentials, revoke existing sessions, and issue a fresh session.

Sessions use 32-byte random tokens, hashed in the database, with a 12-hour absolute lifetime. Cookies are HttpOnly and SameSite=Strict. Production adds Secure and the `__Host-` prefix. Writes require the exact configured origin and a session-bound CSRF token. Registration/login also reject cross-site origins. Authentication, challenge, sensitive operations, and general requests are rate-limited; expensive scrypt work is capped at two concurrent operations. Rate-limit state is in memory for this single-instance backend.

Vault revisions use compare-and-swap updates. A stale writer receives HTTP 409 and cannot overwrite a newer diary. The UI offers an encrypted backup and explicit reopening instead of silently discarding either version.

Only an explicit public asset allowlist is served. Database files, source backend files, environment files, and arbitrary filesystem paths are unavailable through HTTP. CSP disallows inline scripts/styles and external resources; framing, MIME sniffing, and referrer leakage are restricted. No third-party fonts, advertising, or analytics scripts are loaded. The server deliberately omits request bodies, credentials, emails, and diary content from application logs.

## Recovery, export, and deletion

There is no server-held unlock key and no passphrase reset that can recover the diary. Keep the passphrase in a password manager and make encrypted backups. Backups made before a passphrase change still require their original passphrase.

An encrypted backup includes its account ID, derivation salt, and ciphertext, so it can be opened and merged into another account using the backup's passphrase. Readable exports intentionally contain decrypted entries and drafts and require an explicit confirmation in the app. Keep them private.

Pending writes use encrypted, per-account/per-tab browser recovery records. They contain no unlock key. Reopening restores them automatically only when their base revision matches the server; older conflicting copies are kept separately for download. Copies from other or closed tabs are offered for download without replacing the current server diary. Account deletion removes that account's recovery copies accessible in the current browser. Copies on other devices and independent backups are outside the server's deletion boundary. Older prototype localStorage records are not automatically migrated or deleted.

Deleting a saved entry or clearing the diary updates the encrypted vault. Account deletion cascades through vaults and sessions. Database/volume backups can still contain previous encrypted versions; configure retention according to your needs.

## Hosting assumptions and limits

- Use HTTPS, an exact `APP_ORIGIN`, a persistent data volume, private backend networking, and restricted database/backup access. Development mode is for loopback only.
- Enable `TRUST_PROXY` only behind a proxy you control that sets forwarding headers, with direct backend access blocked. The supplied Compose setup exposes only Caddy's HTTP/HTTPS ports and enables this trust for that arrangement.
- Use one app instance with its SQLite volume. Multi-instance operation needs a shared transactional database and distributed rate limiting.
- Email addresses are login identifiers; no email verification, email delivery, OAuth, or MFA is implemented. A server can enforce the credential format and derivation protocol; the passphrase length check happens in the client because it never sends the passphrase.
- Anyone using an unlocked diary or controlling the device can read visible writing. Malicious browser extensions, compromised frontend delivery, an active malicious host, or injected code can capture plaintext or keys while unlocked. Browser encryption does not eliminate those risks.

## Verification and references

Run `npm test`. The suite exercises real HTTP authentication/ownership, encrypted database storage, persistence after restart, cookie/CSP headers, CSRF/origin enforcement, stale writes, password rotation, account deletion, tamper rejection, draft normalization, reflection editing, and idempotent quest claims.

Implementation references: [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [OWASP CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), and [Web Crypto key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey).
