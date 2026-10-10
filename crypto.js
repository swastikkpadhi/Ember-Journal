// Password material stays in the browser. Auth and encryption use separate HKDF domains.
export const KDF_ITERATIONS = 600_000;
const utf8 = new TextEncoder();

export function toBase64(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value) {
  return Uint8Array.from(atob(value), character => character.charCodeAt(0));
}

export function newSalt() {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveSecrets(password, salt) {
  if (!crypto.subtle) throw new Error('Open Ember on HTTPS or localhost to unlock your diary.');
  const material = await crypto.subtle.importKey('raw', utf8.encode(password), 'PBKDF2', false, ['deriveBits']);
  const root = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: fromBase64(salt), iterations: KDF_ITERATIONS, hash: 'SHA-256' }, material, 256);
  const hkdf = await crypto.subtle.importKey('raw', root, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const parameters = info => ({ name: 'HKDF', hash: 'SHA-256', salt: utf8.encode('ember-journal/v1'), info: utf8.encode(info) });
  const auth = await crypto.subtle.deriveBits(parameters('authentication'), hkdf, 256);
  const key = await crypto.subtle.deriveKey(parameters('diary-encryption'), hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  new Uint8Array(root).fill(0);
  return { credential: toBase64(auth), key };
}

export async function encryptVault(state, key, accountId) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = utf8.encode(JSON.stringify(state));
  try {
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode('ember-vault/v1/' + accountId), tagLength: 128 }, key, plaintext);
    return { format: 1, iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
  } finally { plaintext.fill(0); }
}

export async function decryptVault(envelope, key, accountId) {
  if (!envelope || envelope.format !== 1) throw new Error('This diary uses an unsupported encryption format.');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv), additionalData: utf8.encode('ember-vault/v1/' + accountId), tagLength: 128 }, key, fromBase64(envelope.ciphertext));
  try { return JSON.parse(new TextDecoder().decode(plaintext)); }
  finally { new Uint8Array(plaintext).fill(0); }
}
