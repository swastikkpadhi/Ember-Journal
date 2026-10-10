import { deriveSecrets, newSalt, encryptVault, decryptVault } from './crypto.js';
import { QUESTION_GROUPS, QUESTIONS, DAILY_PROMPTS } from './questions.js';
import { MOODS, MOOD_FACES, TAGS, BADGES, emptyState, normalizeState, entryDraft, checkinDraft, iso, addDate, weekStart, wordCount, level, streak, applyShield, addEntry, saveCheckin, quests, claimQuest, deleteEntry } from './domain.js';

const root = document.getElementById('root'), modal = document.getElementById('modal');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const ICONS = {
  book:'<path d="M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4z"/><path d="M20 4h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3z"/>',
  pen:'<path d="m15 4 5 5-11 11-6 1 1-6z"/><path d="m12 7 5 5"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-12 5h.01M12 16h.01M16 16h.01"/>',
  leaf:'<path d="M20 3c-8-1-16 3-16 10a6 6 0 0 0 11 3c4-4 5-8 5-13Z"/><path d="M4 21 15 10"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5"/>',
  moon:'<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',
  chart:'<path d="M4 3v17h17M8 16v-5m5 5V6m5 10V9"/>',
  settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
  arrow:'<path d="M4 12h15m-6-6 6 6-6 6"/>',
  back:'<path d="M20 12H5m6-6-6 6 6 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  star:'<path d="m12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.3-5.7-3-5.7 3 1.1-6.3L3.1 9.7l6.1-.9z"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  people:'<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/>',
  cloud:'<path d="M6 19a5 5 0 1 1 0-10 6 6 0 0 1 11-1 5.5 5.5 0 0 1 0 11Z"/>',
  eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.leaf}</svg>`;
const brand = (mobile = false) => `<div class="brand ${mobile ? 'mobile-brand' : ''}"><span class="brand-symbol" aria-hidden="true">✳</span><div><span class="brand-name">ember</span>${mobile ? '' : '<small>a little space for yourself</small>'}</div></div>`;
const NAV = [['today','pen','Today'], ['timeline','calendar','Timeline'], ['quests','leaf','Quests'], ['reflect','spark','Reflect'], ['insights','chart','Insights'], ['settings','settings','Settings']];
let user = null, vaultKey = null, csrf = '', state = null, revision = 0, page = 'today';
let authView = 'login', rememberedEmail = '', busy = false, editingId = null, editDraft = null;
let generation = 0, savedGeneration = 0, saveTimer = null, saving = null, saveError = '', conflicted = false, pendingRecovery = null;
let pendingRecoveryStorageKey = '';
let query = '', journalFilter = '', selectedDay = iso(), calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let promptIndex = Number(iso().replaceAll('-', '')) % DAILY_PROMPTS.length, modalAction = null, toastTimer = null, idleTimer = null;
let tabId;
try { tabId = sessionStorage.getItem('ember_tab') || crypto.randomUUID(); sessionStorage.setItem('ember_tab', tabId); }
catch { tabId = crypto.randomUUID(); }
const pendingKey = () => 'ember_pending_' + user.id + '_' + tabId;
function findOtherRecovery() {
  if (pendingRecovery) return;
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('ember_pending_' + user.id + '_') || key === pendingKey()) continue;
      try {
        const copy = JSON.parse(localStorage.getItem(key));
        if (copy?.accountId === user.id && copy.vault && copy.salt) { pendingRecovery = copy; pendingRecoveryStorageKey = key; break; }
      } catch { /* Ignore a malformed browser record without changing it. */ }
    }
  } catch { /* Server diaries remain available when browser storage is disabled. */ }
}

async function api(path, method = 'GET', data) {
  let response;
  try { response = await fetch('/api' + path, { method, credentials:'same-origin', headers: { ...(data ? { 'Content-Type':'application/json' } : {}), ...(csrf ? { 'X-CSRF-Token':csrf } : {}) }, ...(data ? { body:JSON.stringify(data) } : {}), signal:AbortSignal.timeout(20000) }); }
  catch { throw new Error('Connection interrupted. Your open diary is still here; reconnect and try saving again.'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('The diary server returned an unexpected response.'); }
  if (!response.ok) { const error = new Error(result.error || 'Something went wrong.'); error.status = response.status; throw error; }
  return result;
}
function toast(message) { const node = document.getElementById('toast'); node.textContent = message; node.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 4500); }
function applyAppearance() { document.body.dataset.mode = state?.preferences.mode || 'light'; document.body.dataset.font = state?.preferences.font || 'serif'; }
function dateLabel(day, options = { month:'short', day:'numeric', year:'numeric' }) { return new Date(day + 'T12:00:00').toLocaleDateString(undefined, options); }
function statusText() { return conflicted ? 'Save paused · another session changed' : saveError ? 'Waiting to save · retry' : saving ? 'Encrypting & saving…' : generation > savedGeneration ? 'Saving your changes…' : 'Encrypted & saved'; }
function updateStatus() {
  const node = document.getElementById('save-status');
  if (node) { node.textContent = statusText(); node.className = 'text-btn save-status ' + (saveError || conflicted ? 'failed' : generation > savedGeneration ? 'unsaved' : ''); node.title = saveError || 'Your diary is encrypted before it leaves this browser.'; }
}
function markDirty() { generation++; saveError = ''; clearTimeout(saveTimer); saveTimer = setTimeout(() => flushSave(), 700); updateStatus(); }
async function protectPending(snapshot, key = vaultKey, accountId = user.id, baseRevision = revision) {
  const vault = await encryptVault(snapshot, key, accountId);
  try { localStorage.setItem(pendingKey(), JSON.stringify({ format:1, accountId, salt:user.salt, baseRevision, vault })); }
  catch { /* The server save can still succeed when local browser storage is unavailable. */ }
  return vault;
}
async function flushSave() {
  clearTimeout(saveTimer);
  if (!vaultKey || !state || conflicted) return false;
  if (saving) return saving;
  if (generation <= savedGeneration) { updateStatus(); return true; }
  saving = (async () => {
    try {
      while (savedGeneration < generation) {
        const currentGeneration = generation, snapshot = structuredClone(state);
        const vault = await protectPending(snapshot);
        const result = await api('/vault', 'PUT', { revision, vault });
        revision = result.revision; savedGeneration = currentGeneration; saveError = '';
        try { localStorage.removeItem(pendingKey()); } catch { /* no plaintext fallback */ }
      }
      return true;
    } catch (error) { saveError = error.message; conflicted = error.status === 409; updateStatus(); if (conflicted) render(); return false; }
    finally { saving = null; updateStatus(); }
  })();
  updateStatus(); return saving;
}
async function saveFeedback(message) { if (await flushSave()) toast(message); else toast(saveError || 'Saving is paused. Keep your backup before reopening.'); }
function showModal(title, content, label, action, danger = false) {
  modalAction = action;
  modal.innerHTML = `<h2 id="modal-title">${esc(title)}</h2>${content}<p id="modal-error" class="error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" data-action="modal-close">Cancel</button>${label ? `<button class="btn ${danger ? 'danger' : ''}" data-action="modal-confirm">${esc(label)}</button>` : ''}</div>`;
  modal.showModal();
}
function emptyCard(title, detail) { return `<div class="card empty"><span aria-hidden="true">✳</span><h3>${esc(title)}</h3><p>${esc(detail)}</p></div>`; }
function heading(eyebrow, title, detail) { return `<header class="page-heading"><div><p class="eyebrow">${esc(eyebrow)}</p><h1>${title}</h1><p>${esc(detail)}</p></div><div class="heading-flower" aria-hidden="true">✳</div></header>`; }
function progress(value, max, label) { return `<div class="guide-progress"><div class="bar"><progress max="${max}" value="${Math.min(value, max)}" aria-label="${esc(label)}"></progress></div><span>${Math.min(value, max)}/${max}</span></div>`; }

function renderAuth(error = '') {
  applyAppearance();
  const registering = authView === 'register';
  root.innerHTML = `<main id="main" class="auth-page">${brand()}<div class="auth-layout"><section class="auth-story"><p class="eyebrow">YOUR THOUGHTS. YOUR LITTLE SANCTUARY.</p><h1>Make room<br>for <em>yourself.</em></h1><p>A few honest words. A softer end to the day. A private place to hold what matters.</p><div class="auth-art" aria-hidden="true"><div class="art-hill"></div><div class="art-stem"></div><div class="art-orbit"></div></div><span class="badge">${icon('lock')} Encrypted, just for you</span></section><section class="auth-card card"><div class="auth-tabs" role="group" aria-label="Account action"><button class="${registering ? '' : 'selected'}" aria-pressed="${!registering}" data-action="auth-tab" data-view="login">Sign in</button><button class="${registering ? 'selected' : ''}" aria-pressed="${registering}" data-action="auth-tab" data-view="register">Create account</button></div><h2>${registering ? 'Begin your journal' : 'Welcome back'}</h2><p class="hint">${registering ? 'A small space that belongs to you.' : 'Unlock your diary and pick up where you left off.'}</p><form id="auth-form">${registering ? '<div class="field"><label for="auth-name">What should we call you? <span class="muted">(optional)</span></label><input id="auth-name" name="name" autocomplete="given-name" maxlength="80" placeholder="Your first name"></div>' : ''}<div class="field"><label for="auth-email">Email address</label><input id="auth-email" name="email" type="email" autocomplete="email" maxlength="254" required value="${esc(rememberedEmail)}" placeholder="you@example.com"></div><div class="field"><label for="auth-password">Passphrase</label><div class="password-row"><input id="auth-password" name="password" type="password" autocomplete="${registering ? 'new-password' : 'current-password'}" minlength="12" maxlength="256" required placeholder="${registering ? 'At least 12 characters' : 'Your private passphrase'}"><button type="button" class="icon-btn" data-action="show-password" data-target="auth-password" aria-label="Show passphrase">${icon('eye')}</button></div></div>${registering ? '<div class="field"><label for="auth-confirm">Confirm passphrase</label><input id="auth-confirm" name="confirm" type="password" autocomplete="new-password" minlength="12" maxlength="256" required placeholder="Once more, to be sure"></div><label class="inline-label"><input name="understand" type="checkbox" required><span class="hint">I understand that a forgotten passphrase cannot be reset to recover my diary. I will keep it somewhere safe.</span></label>' : ''}<p id="auth-error" class="error" role="alert">${esc(error)}</p><button class="btn" id="auth-submit" type="submit">${registering ? 'Create my private journal' : 'Unlock my journal'} ${icon('arrow')}</button></form><div class="auth-note"><p>${icon('lock')} Your writing is encrypted on your device. Your passphrase is never sent to the server.</p></div><button class="text-btn" data-action="privacy">How your privacy works</button></section></div><p class="auth-foot">A space for reflection, at your pace. Every question is optional.</p></main>`;
}

async function authenticate(form) {
  if (busy) return; busy = true;
  const button = document.getElementById('auth-submit'), errorNode = document.getElementById('auth-error');
  button.disabled = true; button.textContent = authView === 'register' ? 'Creating your private space…' : 'Unlocking your diary…'; errorNode.textContent = '';
  const input = new FormData(form), password = input.get('password'), email = input.get('email').trim().toLowerCase(); rememberedEmail = email;
  try {
    let result, secrets, nextState, remote;
    if (authView === 'register') {
      if (password !== input.get('confirm')) throw new Error('Your passphrases do not match.');
      if (!input.get('understand')) throw new Error('Please confirm that you will keep your passphrase safe.');
      const salt = newSalt(), id = crypto.randomUUID(); secrets = await deriveSecrets(password, salt);
      nextState = emptyState(input.get('name').trim());
      const vault = await encryptVault(nextState, secrets.key, id);
      result = await api('/auth/register', 'POST', { id, email, salt, credential:secrets.credential, vault }); remote = { revision:result.revision };
    } else {
      const challenge = await api('/auth/challenge', 'POST', { email });
      secrets = await deriveSecrets(password, challenge.salt);
      result = await api('/auth/login', 'POST', { email, credential:secrets.credential });
      csrf = result.csrf; remote = await api('/vault');
      nextState = normalizeState(await decryptVault(remote.vault, secrets.key, result.user.id));
    }
    user = result.user; csrf = result.csrf; vaultKey = secrets.key; state = nextState; revision = remote.revision; authView = 'login';
    generation = 0; savedGeneration = 0; conflicted = false; saveError = ''; pendingRecovery = null; pendingRecoveryStorageKey = ''; page = 'today';
    try {
      const recovery = JSON.parse(localStorage.getItem(pendingKey() + '_recovery') || 'null');
      if (recovery?.accountId === user.id && recovery.vault) { pendingRecovery = recovery; pendingRecoveryStorageKey = pendingKey() + '_recovery'; }
      const pending = JSON.parse(localStorage.getItem(pendingKey()) || 'null');
      if (pending?.vault && pending.accountId === user.id) {
        if (pending.baseRevision === revision) { state = normalizeState(await decryptVault(pending.vault, vaultKey, user.id)); generation++; toast('Your unfinished changes were recovered.'); }
        else { pendingRecovery = pending; pendingRecoveryStorageKey = pendingKey() + '_recovery'; localStorage.setItem(pendingRecoveryStorageKey,JSON.stringify(pending)); localStorage.removeItem(pendingKey()); }
      }
    } catch { toast('An older recovery copy could not be opened. Your server diary is intact.'); }
    findOtherRecovery();
    editingId = state.drafts.edit?.id || null; editDraft = state.drafts.edit?.value || null;
    if (applyShield(state)) generation++;
    if (!Object.values(state.drafts.checkin.answers).some(value => value.trim()) && state.drafts.checkin.date !== iso()) { state.drafts.checkin = checkinDraft(); generation++; }
    form.reset(); applyAppearance(); render(); window.scrollTo({top:0,behavior:'instant'}); resetIdle();
    if (generation) flushSave();
  } catch (error) { errorNode.textContent = error.message; document.getElementById('auth-password').value = ''; const confirm = document.getElementById('auth-confirm'); if (confirm) confirm.value = ''; }
  finally { busy = false; if (button.isConnected) { button.disabled = false; button.innerHTML = `${authView === 'register' ? 'Create my private journal' : 'Unlock my journal'} ${icon('arrow')}`; } }
}

function entryHTML(entry) {
  const journal = state.j.find(j => j.id === entry.j)?.t || 'Personal';
  const answers = QUESTIONS.filter(q => entry.answers?.[q.id]?.trim());
  return `<article class="card entry"><div class="row between"><span class="entry-date">${MOOD_FACES[entry.m - 1]} &nbsp; ${esc(dateLabel(entry.d))} · ${esc(journal)}</span><div class="row"><button class="icon-btn ${state.favorites.includes(entry.id) ? 'active' : ''}" data-action="favorite" data-id="${esc(entry.id)}" aria-label="${state.favorites.includes(entry.id) ? 'Remove favorite' : 'Favorite entry'}" aria-pressed="${state.favorites.includes(entry.id)}">${icon('star')}</button><button class="icon-btn" data-action="edit" data-id="${esc(entry.id)}" aria-label="Edit entry">${icon('pen')}</button><button class="icon-btn" data-action="delete-entry" data-id="${esc(entry.id)}" aria-label="Delete entry">${icon('trash')}</button></div></div>${entry.title ? `<h3>${esc(entry.title)}</h3>` : ''}${answers.length && entry.kind === 'checkin' ? `<p class="hint">Your daily reflection · ${answers.length} questions answered</p><details><summary>Open this reflection</summary>${answers.map(q => `<section class="entry-answer"><h4>${esc(q.title)}</h4><p>${esc(entry.answers[q.id])}</p></section>`).join('')}</details>` : entry.t ? `<div class="entry-text">${esc(entry.t)}</div>` : `<p class="entry-text">A moment to check in. Energy: ${entry.en}%.</p>`}<div class="entry-tags">${entry.g.map(tag => `<span>${esc(tag)}</span>`).join('')}</div></article>`;
}
function moodInput(draft, target) {
  return `<div class="field"><label>How are you feeling?</label><div class="mood-options" role="group" aria-label="Choose your mood">${MOODS.map((mood, index) => `<button type="button" class="mood-choice ${draft.m === index + 1 ? 'selected' : ''}" data-action="mood" data-target="${target}" data-value="${index + 1}" aria-pressed="${draft.m === index + 1}"><span aria-hidden="true">${MOOD_FACES[index]}</span><small>${mood}</small></button>`).join('')}</div></div>`;
}
function todayView() {
  const day = iso(), entries = state.e.filter(e => e.d === day).sort((a,b) => b.ts-a.ts), seven = state.e.filter(e => e.d >= addDate(day,-6) && e.d <= day);
  const days = new Set(seven.map(e => e.d)).size, monthDays = new Set(state.e.filter(e => e.d.startsWith(day.slice(0,7))).map(e => e.d)).size, draft = editingId ? editDraft : state.drafts.entry;
  const hour = new Date().getHours(), greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return `${heading('A MOMENT, JUST FOR YOU', `${greeting}${state.preferences.name ? ', ' + esc(state.preferences.name) : ''}.`, 'Let the day settle. Your thoughts can be unfinished here.')}<div class="metrics"><article class="metric"><div class="row"><span>YOUR GENTLE RHYTHM</span>${icon('leaf')}</div><strong>${streak(state)}</strong><small>day${streak(state) === 1 ? '' : 's'} in a row</small></article><article class="metric"><div class="row"><span>THIS WEEK</span>${icon('sun')}</div><strong>${days}<span class="hint"> / 7</span></strong><small>day${days === 1 ? '' : 's'} you made room</small></article><article class="metric"><div class="row"><span>THIS MONTH</span>${icon('book')}</div><strong>${monthDays}</strong><small>day${monthDays === 1 ? '' : 's'} of reflection</small></article></div><div class="today-grid"><section><form class="card" id="entry-form"><div class="editor-header"><div><p class="eyebrow">${editingId ? 'RETURN TO A MOMENT' : 'YOUR OPEN PAGE'}</p><h2>${editingId ? 'Edit your entry' : 'How was your day?'}</h2></div>${icon('pen')}</div>${moodInput(draft,'entry')}<div class="editor-meta"><div class="field"><label for="energy">Your energy · <span id="energy-label">${draft.en}</span>%</label><input id="energy" type="range" min="0" max="100" value="${draft.en}" data-draft="en"></div><div class="field"><label for="journal">A place for this thought</label><select id="journal" data-draft="j">${state.j.map(j => `<option value="${esc(j.id)}" ${j.id === draft.j ? 'selected' : ''}>${esc(j.t)}</option>`).join('')}</select></div></div><div class="field"><label>What was part of your day?</label><div class="tags">${TAGS.map(tag => `<button type="button" class="tag ${draft.g.includes(tag) ? 'selected' : ''}" data-action="tag" data-tag="${tag}" aria-pressed="${draft.g.includes(tag)}">${tag}</button>`).join('')}</div></div><div class="notebook"><label class="skip-label" for="entry-title">Entry title (optional)</label><input class="title-input" id="entry-title" data-draft="title" maxlength="120" placeholder="Give this moment a name…" value="${esc(draft.title)}"><label class="skip-label" for="entry-text">Your entry</label><textarea id="entry-text" data-draft="t" maxlength="60000" placeholder="Start wherever you are. What is on your mind?">${esc(draft.t)}</textarea><div class="notebook-footer"><span>${icon('lock')} Your private page</span><span id="word-count">${wordCount(draft.t)} words</span></div></div><div class="editor-actions"><button type="submit" class="btn accent">${editingId ? 'Save changes' : 'Keep this moment'} ${icon('arrow')}</button>${editingId ? '<button type="button" class="btn secondary" data-action="cancel-edit">Cancel edit</button>' : '<button type="button" class="text-btn" data-action="quick-log">Just log my mood</button>'}</div><p class="hint guidance">${editingId ? 'Your edit is kept as an encrypted draft until you choose Save changes.' : 'Your unfinished page is encrypted and saved as you write.'}</p></form></section><aside class="aside-stack"><section class="card prompt-card"><p class="eyebrow">A GENTLE NUDGE</p><blockquote id="daily-prompt">${esc(DAILY_PROMPTS[promptIndex])}</blockquote><button class="text-btn" data-action="next-prompt">Another question ${icon('arrow')}</button></section><section class="card guide-card"><div class="guide-symbol">${icon('spark')}</div><h3>A little look back</h3><p>Walk through your day, one gentle question at a time. Feelings, good moments, people, and what you need.</p><button class="btn soft" data-action="navigate" data-page="reflect">Reflect on my day ${icon('arrow')}</button></section><section class="card note-card"><p>“You do not have to make sense of everything to make a little space for it.”</p></section></aside></div><div class="section-title"><h2>Moments you kept today</h2><span class="hint">${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}</span></div>${entries.map(entryHTML).join('') || emptyCard('Your page is still open', 'A mood, a memory, a few honest words. Begin wherever you like.')}`;
}
function calendarHTML() {
  const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth(), offset = (new Date(year, month, 1).getDay() + 6) % 7, count = new Date(year, month + 1, 0).getDate();
  let days = '<span></span>'.repeat(offset);
  for (let day = 1; day <= count; day++) {
    const date = iso(new Date(year, month, day)), entries = state.e.filter(e => e.d === date), average = entries.length ? Math.round(entries.reduce((n,e) => n+e.m,0)/entries.length) : 0;
    days += `<button class="calendar-day ${entries.length ? 'has-entry' : ''} ${selectedDay === date ? 'selected' : ''} ${date === iso() ? 'today' : ''}" data-action="select-day" data-day="${date}" aria-label="${esc(dateLabel(date))}, ${entries.length} entries${average ? ', ' + MOODS[average - 1] + ' average mood' : ''}" aria-pressed="${selectedDay === date}">${day}${average ? `<span aria-hidden="true">${MOOD_FACES[average - 1]}</span>` : ''}</button>`;
  }
  const monthly = state.e.filter(e => e.d.startsWith(iso(calendarMonth).slice(0,7)));
  return `<section class="card calendar"><div class="row between"><button class="icon-btn" data-action="month" data-value="-1" aria-label="Previous month">${icon('back')}</button><b class="serif">${calendarMonth.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</b><button class="icon-btn" data-action="month" data-value="1" aria-label="Next month">${icon('arrow')}</button></div><div class="calendar-week">${['M','T','W','T','F','S','S'].map(d => `<span>${d}</span>`).join('')}</div><div class="calendar-days">${days}</div><div class="calendar-summary">${monthly.length} moments · ${new Set(monthly.map(e => e.d)).size} days with a check-in</div><button class="text-btn" data-action="all-days">Browse every entry</button></section>`;
}
function filteredEntries() {
  const lower = query.trim().toLowerCase();
  return state.e.filter(e => (!selectedDay || lower || e.d === selectedDay) && (!journalFilter || e.j === journalFilter) && (!lower || (e.t + ' ' + e.title + ' ' + e.g.join(' ')).toLowerCase().includes(lower))).sort((a,b) => b.ts-a.ts);
}
function updateTimelineList() { const box = document.getElementById('timeline-entries'); if (box) box.innerHTML = filteredEntries().map(entryHTML).join('') || emptyCard('No moments here yet', query ? 'Try another word or activity.' : 'Your saved writing will be here whenever you want to return.'); }
function timelineView() {
  return `${heading('PAGES TO RETURN TO','Your days, gently kept.','Browse your moments, notice a pattern, or revisit something that mattered.')}<div class="timeline-tools"><div><label for="search">Find a moment</label><input id="search" type="search" placeholder="A word, a feeling, an activity…" value="${esc(query)}"></div><div><label for="journal-filter">Journal</label><select id="journal-filter"><option value="">All journals</option>${state.j.map(j => `<option value="${esc(j.id)}" ${journalFilter === j.id ? 'selected' : ''}>${esc(j.t)}</option>`).join('')}</select></div></div><div class="timeline-grid">${calendarHTML()}<section class="timeline-list"><div class="section-title"><h2>${query || !selectedDay ? 'Your saved moments' : esc(dateLabel(selectedDay,{month:'long',day:'numeric'}))}</h2></div><div id="timeline-entries">${filteredEntries().map(entryHTML).join('') || emptyCard('No moments here yet','A quiet page is a page, too.')}</div></section></div>`;
}
function reflectView() {
  const draft = state.drafts.checkin, step = draft.step, group = QUESTION_GROUPS[step], answered = QUESTIONS.filter(q => draft.answers[q.id]?.trim()).length;
  return `${heading('AN UNHURRIED LOOK BACK','How did today feel?','A few gentle questions to help you notice your day. Answer what feels useful; leave the rest.')}<div class="guide-layout"><nav class="guide-steps" aria-label="Reflection sections">${QUESTION_GROUPS.map((g,index) => `<button class="step-button ${index === step ? 'selected' : ''} ${g.questions.some(q => draft.answers[q.id]?.trim()) ? 'done' : ''}" data-action="guide-step" data-step="${index}" aria-label="${index + 1}. ${esc(g.title)}" aria-current="${index === step ? 'step' : 'false'}"><span class="step-number">${index + 1}</span><span>${g.title}</span></button>`).join('')}<p class="hint">Take your time.<br>Your unfinished answers are encrypted and saved.</p></nav><section><div class="card guide-panel">${progress(answered,QUESTIONS.length,'Questions answered')}<p class="eyebrow">SECTION ${step + 1} OF 5 · ${esc(dateLabel(draft.date))}</p><h2>${group.title}</h2>${draft.editingId ? '<div class="gentle-note"><p>You are editing a saved reflection. <button class="text-btn" data-action="cancel-guide-edit">Cancel edit</button></p></div>' : ''}<p class="muted">${group.subtitle}</p>${step === 0 ? moodInput(draft,'checkin') + `<div class="field"><label for="checkin-energy">How much energy do you have? <span id="checkin-energy-label">${draft.en}</span>%</label><input id="checkin-energy" type="range" min="0" max="100" value="${draft.en}"></div>` : ''}${group.questions.map(q => `<div class="question"><label for="answer-${q.id}">${q.title} <span class="hint">(optional)</span></label><p id="hint-${q.id}" class="hint">${q.hint}</p><textarea id="answer-${q.id}" data-answer="${q.id}" aria-describedby="hint-${q.id}" maxlength="6000" placeholder="${esc(q.placeholder)}">${esc(draft.answers[q.id] || '')}</textarea></div>`).join('')}<div class="guide-navigation">${step ? `<button class="text-btn" data-action="guide-step" data-step="${step - 1}">${icon('back')} Previous</button>` : '<span class="hint">A word or a sentence is enough.</span>'}${step < 4 ? `<div class="row"><button class="text-btn" data-action="guide-save">Save what I have</button><button class="btn soft" data-action="guide-step" data-step="${step + 1}">Continue or skip ${icon('arrow')}</button></div>` : '<button class="btn accent" data-action="guide-save">Keep my reflection</button>'}</div></div><p class="guidance">This is a reflection exercise, not an assessment or therapy. If writing brings up distress, it is okay to stop and reach out to someone you trust or a qualified professional.</p></section></div><div class="section-title"><h2>Moments close to your heart</h2></div>${state.favorites.map(id => state.e.find(e => e.id === id)).filter(Boolean).map(entryHTML).join('') || emptyCard('Keep a moment close','Favorite an entry to find it here again.')}`;
}
function questsView() {
  return `${heading('SMALL STEPS, KEPT GENTLY','A rhythm of your own.','These are invitations, never obligations. Your writing matters whether or not you keep a streak.')}<div class="two-columns"><section>${quests(state).map((q,index) => `<article class="card quest"><div class="quest-symbol">${icon(['book','pen','sun'][index])}</div><div><h3>${q.title}</h3><p>${q.detail}</p>${progress(q.progress,q.target,q.title)}</div>${state.cl[weekStart() + q.id] ? '<span class="badge">Kept ✓</span>' : q.progress >= q.target ? `<button class="btn soft" data-action="claim" data-id="${q.id}">Keep ${q.xp} XP</button>` : `<span class="hint">${q.xp} XP</span>`}</article>`).join('')}</section><section class="card"><p class="eyebrow">YOUR LITTLE MILESTONES</p><h2>Growing, at your pace.</h2><p class="hint">Level ${level(state)} · ${state.xp} XP · best rhythm ${state.best} day${state.best === 1 ? '' : 's'}</p>${progress(state.xp % 100,100,'Progress to next level')}<div class="badges">${BADGES.map(b => `<div class="milestone ${state.b.includes(b.id) ? 'earned' : ''}">${icon(b.icon)}<small>${b.label}${state.b.includes(b.id) ? ' ✓' : ''}</small></div>`).join('')}</div><p class="guidance">${state.fz ? 'A gentle shield can cover one missed day.' : 'One shield is earned after seven consecutive days.'} Missing a day never removes your writing or earlier milestones.</p></section></div>`;
}
function insightsView() {
  const day = iso(), weekly = state.e.filter(e => e.d >= weekStart() && e.d <= day), average = state.e.length ? state.e.reduce((sum,e) => sum+e.m,0)/state.e.length : 0;
  const tags = new Map(); for (const entry of state.e) for (const tag of entry.g) { const values = tags.get(tag) || []; values.push(entry.m); tags.set(tag,values); }
  const patterns = [...tags].filter(([,v]) => v.length >= 2).map(([tag,v]) => ({ tag, count:v.length, delta:v.reduce((n,m) => n+m,0)/v.length-average })).filter(p => Math.abs(p.delta) > .2).sort((a,b) => b.delta-a.delta);
  const bars = Array.from({length:14},(_,index) => { const date = addDate(day,index-13), entries = state.e.filter(e => e.d === date), mean = entries.length ? entries.reduce((n,e) => n+e.m,0)/entries.length : 0; return `<g><title>${date}: ${mean ? mean.toFixed(1) + ' of 5' : 'no check-in'}</title><rect class="chart-empty" x="${index*35+7}" y="15" width="19" height="130" rx="6"/><rect class="chart-bar" x="${index*35+7}" y="${145-mean/5*130}" width="19" height="${mean/5*130}" rx="6"/><text class="chart-label" x="${index*35+17}" y="164" text-anchor="middle">${Number(date.slice(-2))}</text></g>`; }).join('');
  const weeklyMean = weekly.length ? weekly.reduce((n,e) => n+e.m,0)/weekly.length : 0;
  return `${heading('A KINDER LOOK BACK','Notice your own patterns.','Small snapshots of your check-ins, held with curiosity rather than judgment.')}<div class="two-columns"><section class="card"><p class="eyebrow">YOUR WEEK IN REFLECTION</p><h2>${new Set(weekly.map(e => e.d)).size} day${new Set(weekly.map(e => e.d)).size === 1 ? '' : 's'} of making room.</h2><p class="muted">You kept ${weekly.length} moments this week.${weeklyMean ? ' Your logged mood average is ' + weeklyMean.toFixed(1) + ' out of 5.' : ''}</p><p class="serif">What would you like to carry into next week?</p><button class="text-btn" data-action="navigate" data-page="reflect">Take a moment to reflect ${icon('arrow')}</button></section><section class="card"><p class="eyebrow">THE LAST FOURTEEN DAYS</p><h2>Your mood, over time.</h2><svg class="mood-chart" viewBox="0 0 490 175" role="img" aria-label="Daily mood averages over the last fourteen days, from one to five. Blank bars mean no check-in.">${bars}</svg><p class="hint">Each bar is a daily average. Blank days have no recorded check-in.</p></section></div><div class="section-title"><h2>What your tags might be telling you</h2></div><section class="card">${patterns.length ? patterns.map(p => `<div class="pattern-row"><span>${esc(p.tag)} <small class="muted">· ${p.count} check-ins</small></span><span>${p.delta > 0 ? '+' : ''}${p.delta.toFixed(1)} from your average</span></div>`).join('') : '<p class="muted">Patterns will appear as you keep more moments with activity tags.</p>'}<p class="guidance">These are associations in your own records, not causes or a diagnosis. Everything is calculated here on your device.</p></section>`;
}
function settingsView() {
  const prefs = state.preferences;
  return `${heading('MAKE THIS SPACE YOURS','A few little preferences.','Your diary, your pace, your way of feeling at home.')}<div class="two-columns"><section><div class="card settings-section"><h3>Your corner of Ember</h3><div class="field"><label for="setting-name">What should we call you?</label><input id="setting-name" data-pref="name" maxlength="80" value="${esc(prefs.name)}" placeholder="Your first name"></div><label>Your little companion</label><div class="avatar-options" role="group" aria-label="Choose an avatar">${['🌿','🌼','☀️','🌙','🍂','🪴','🦋','🐚'].map(a => `<button class="avatar-option ${a === prefs.avatar ? 'selected' : ''}" data-action="avatar" data-value="${a}" aria-label="${a} avatar" aria-pressed="${a === prefs.avatar}">${a}</button>`).join('')}</div><div class="setting-row"><div><b>Low-light appearance</b><p>A quiet palette for evening writing.</p></div><input id="dark-mode" type="checkbox" role="switch" aria-label="Low-light appearance" ${prefs.mode === 'dark' ? 'checked' : ''}></div><div class="setting-row"><div><b>Writing font</b><p>Choose a voice for your page.</p></div><select id="setting-font" data-pref="font" aria-label="Writing font">${[['serif','Bookish'],['sans','Simple'],['mono','Typewriter']].map(([id,label]) => `<option value="${id}" ${prefs.font === id ? 'selected' : ''}>${label}</option>`).join('')}</select></div></div><div class="card settings-section"><h3>A gentle reminder</h3><p>A discreet browser notification, only while Ember is open and unlocked.</p><div class="setting-row"><div><b>Reminder time</b></div><input type="time" data-pref="reminderAt" aria-label="Reminder time" value="${prefs.reminderAt}"></div><div class="setting-row"><div><b>Daily reminder</b><p>No diary text appears in notifications.</p></div><button class="btn secondary" data-action="reminder">${prefs.reminders ? 'Turn off' : 'Enable'}</button></div></div><div class="card settings-section"><h3>Your account</h3><p>${esc(user.email)}</p><div class="row wrap"><button class="btn secondary" data-action="change-password">Change passphrase</button><button class="btn secondary" data-action="logout">Sign out</button></div><p class="guidance">Your diary locks after 15 minutes of inactivity. A forgotten passphrase cannot be reset to recover encrypted writing.</p></div></section><section><div class="card settings-section"><h3>Your diary stays yours</h3><p>Your entries, moods, drafts, and reflection answers are encrypted before they reach the server. Your unlock key stays on this device while the diary is open.</p><button class="text-btn" data-action="privacy">About privacy ${icon('arrow')}</button><div class="setting-row"><div><b>Encrypted backup</b><p>A protected copy you can restore with your passphrase.</p></div><button class="icon-btn" data-action="backup" aria-label="Download encrypted backup">${icon('download')}</button></div><div class="setting-row"><div><b>Readable export</b><p>A plain-text JSON copy. Keep it somewhere private.</p></div><button class="icon-btn" data-action="export" aria-label="Export readable diary">${icon('download')}</button></div><div class="field"><label for="import-file">Restore a backup or import an older diary</label><input id="import-file" class="file-input" type="file" accept="application/json,.json"><p class="hint">Imported entries are merged; existing entries stay intact.</p></div></div><div class="card settings-section"><h3>When you want a fresh page</h3><p>Clear your saved entries and progress, or permanently delete your account and diary. Your browser may keep a separate recovery copy until it is removed.</p><div class="row wrap"><button class="btn danger" data-action="clear-diary">Clear my diary</button><button class="btn danger" data-action="delete-account">Delete account</button></div></div><div class="card note-card"><p>Take what feels useful.<br>Leave what does not.<br>This little space belongs to you.</p></div></section></div>`;
}
function render() {
  if (!vaultKey || !state) { renderAuth(); return; }
  applyAppearance();
  root.innerHTML = `<div class="app-layout"><aside class="sidebar">${brand()}<nav class="nav" aria-label="Journal sections">${NAV.map(([id,glyph,label]) => `<button class="nav-button ${page === id ? 'selected' : ''}" data-action="navigate" data-page="${id}" aria-current="${page === id ? 'page' : 'false'}">${icon(glyph)}<span>${label}</span></button>`).join('')}</nav><div class="sidebar-note"><span aria-hidden="true">✳</span><p>A few honest words<br>are enough for today.</p></div><div class="sidebar-bottom"><div class="row"><span class="avatar">${esc(state.preferences.avatar)}</span><div class="grow"><b>${esc(state.preferences.name || 'Your private space')}</b><br><span class="hint">Only you hold the key.</span></div></div><button class="text-btn" data-action="lock">${icon('lock')} Lock my journal</button></div></aside><div class="workspace"><header class="topbar">${brand(true)}<span class="date">${new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'})}</span><div class="row"><button class="text-btn" id="save-status" data-action="retry-save"></button><button class="icon-btn" data-action="lock" aria-label="Lock diary">${icon('lock')}</button></div></header><main id="main" class="content">${conflicted || saveError ? `<div class="conflict-banner" role="alert"><p>${esc(saveError)}</p><div class="row wrap"><button class="text-btn" data-action="backup">Download a protected backup</button>${conflicted ? '<button class="text-btn" data-action="reopen">Reopen saved diary</button>' : '<button class="text-btn" data-action="retry-save">Retry saving</button>'}</div></div>` : ''}${pendingRecovery ? '<div class="conflict-banner"><p>An unfinished recovery copy is available. Download it before removing it; your current server diary has been kept.</p><div class="row"><button class="text-btn" data-action="pending-backup">Download recovery copy</button><button class="text-btn" data-action="dismiss-pending">Remove recovery copy</button></div></div>' : ''}${({today:todayView,timeline:timelineView,quests:questsView,reflect:reflectView,insights:insightsView,settings:settingsView})[page]()}</main></div></div>`;
  updateStatus();
}

function download(value, name) { const url = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); }
async function backup() { const vault = await encryptVault(state,vaultKey,user.id); download({ kind:'ember-encrypted-backup', format:1, accountId:user.id, salt:user.salt, exportedAt:new Date().toISOString(), vault }, 'ember-private-backup-' + iso() + '.json'); toast('Your protected backup was downloaded. Keep its passphrase safe.'); }
function resetIdle() { if (!vaultKey) return; clearTimeout(idleTimer); idleTimer = setTimeout(() => lockDiary(false,true),15*60*1000); }
async function lockDiary(logout = false, automatic = false) {
  if (!vaultKey) return;
  if (busy && automatic) { resetIdle(); return; }
  if (!(await flushSave()) && generation > savedGeneration) {
    try {
      await protectPending(structuredClone(state));
      const recovery = JSON.parse(localStorage.getItem(pendingKey()) || 'null');
      if (!recovery?.vault) throw new Error('Could not protect unsaved changes.');
    } catch { toast('Your changes could not be saved. Download a protected backup before locking.'); resetIdle(); return; }
  }
  if (logout) { try { await api('/auth/logout','POST',{}); } catch (error) { toast(error.message); return; } }
  rememberedEmail = user.email; authView = 'login'; clearTimeout(idleTimer); clearTimeout(saveTimer); vaultKey = null; state = null; user = null; csrf = ''; editingId = null; editDraft = null;
  if (modal.open) modal.close(); modal.innerHTML = ''; modalAction = null;
  renderAuth(); toast(automatic ? 'Your diary locked after a quiet pause.' : logout ? 'Signed out. Your diary is locked.' : 'Your diary is locked.');
}
async function submitEntry(quick = false) {
  if (busy) return; busy = true;
  try {
    if (editingId) {
      const original = state.e.find(e => e.id === editingId);
      if (!editDraft.t.trim() && !quick) throw new Error('Write a few words before saving this entry.');
      Object.assign(original,{...structuredClone(editDraft),t:quick ? '' : editDraft.t.trim(),q:quick,editedAt:Date.now()});
      editingId = null; editDraft = null; state.drafts.edit = null;
    } else { addEntry(state,state.drafts.entry,quick); state.drafts.entry = entryDraft(); }
    markDirty(); render(); await saveFeedback(quick ? 'A little check-in, kept.' : 'Your moment is safely kept.');
  } catch (error) { toast(error.message); } finally { busy = false; }
}
async function importFile(file) {
  if (!file) return;
  if (file.size > 8*1024*1024) { toast('Choose a backup smaller than 8 MB.'); return; }
  let imported;
  try { imported = JSON.parse(await file.text()); } catch { toast('This file could not be read as a diary backup.'); return; }
  let restored;
  if (imported.kind === 'ember-encrypted-backup') {
    showModal('Open your protected backup', '<p>Enter the passphrase used when this backup was made. It can be different from your current passphrase.</p><div class="field"><label for="backup-password">Backup passphrase</label><input id="backup-password" type="password" autocomplete="off" maxlength="256"></div>', 'Open & merge', async () => {
      const password = document.getElementById('backup-password').value;
      const secrets = await deriveSecrets(password,imported.salt);
      try { restored = normalizeState(await decryptVault(imported.vault,secrets.key,imported.accountId)); } catch { throw new Error('The backup could not be opened. Check its passphrase and file.'); }
      await mergeImport(restored);
    });
  } else {
    try { restored = normalizeState(Array.isArray(imported.entries) ? {...emptyState(),e:imported.entries} : imported); }
    catch (error) { toast(error.message); return; }
    showModal('Import these moments?', `<p>${restored.e.length} entries will be added to your encrypted diary. Existing entries stay intact.</p>`, 'Import entries', () => mergeImport(restored));
  }
}
async function mergeImport(restored) {
  const existing = new Set(state.e.map(e => JSON.stringify([e.d,e.t,e.m,e.answers]))), ids = new Set(state.e.map(e => e.id)); let count = 0;
  const journals = new Map(state.j.map(j => [j.id,j.t]));
  for (const entry of restored.e) {
    const signature = JSON.stringify([entry.d,entry.t,entry.m,entry.answers]); if (existing.has(signature)) continue;
    if (ids.has(entry.id)) entry.id = crypto.randomUUID(); ids.add(entry.id); existing.add(signature);
    const sourceJournal = restored.j.find(j => j.id === entry.j);
    if (!journals.has(entry.j)) { state.j.push({id:entry.j,t:sourceJournal?.t || 'Imported'}); journals.set(entry.j,sourceJournal?.t || 'Imported'); }
    state.e.push(entry); state.xp += entry.x || 0; count++;
  }
  state.best = Math.max(state.best,streak(state)); markDirty(); render(); await saveFeedback(`${count} moments added to your diary.`);
}
function privacyModal() {
  showModal('Your writing belongs to you', '<p>Diary text, mood logs, drafts, settings, and reflection answers are encrypted in your browser using your passphrase. The backend stores the encrypted diary and account metadata, including your email address.</p><p>Your unlock key stays in memory while the diary is open. Locking or closing the page removes it. No diary text is sent to an AI service, and there are no advertising or analytics scripts.</p><p>Use a unique passphrase and a trusted device. Someone with access to your unlocked diary can read it. A forgotten passphrase cannot be reset to recover your writing. Keep an encrypted backup.</p><p>A compromised device or application host can affect browser encryption. Ember does not claim protection from every form of access.</p>', '', null);
}

document.addEventListener('submit', event => {
  if (event.target.id === 'auth-form') { event.preventDefault(); authenticate(event.target); }
  if (event.target.id === 'entry-form') { event.preventDefault(); submitEntry(); }
});
document.addEventListener('input', event => {
  const node = event.target;
  if (!state) return;
  if (node.dataset.draft) {
    const draft = editingId ? editDraft : state.drafts.entry;
    draft[node.dataset.draft] = node.dataset.draft === 'en' ? Number(node.value) : node.value;
    if (node.id === 'energy') document.getElementById('energy-label').textContent = node.value;
    if (node.id === 'entry-text') document.getElementById('word-count').textContent = wordCount(node.value) + ' words';
    markDirty();
  } else if (node.dataset.answer) { state.drafts.checkin.answers[node.dataset.answer] = node.value; markDirty(); const count = QUESTIONS.filter(q => state.drafts.checkin.answers[q.id]?.trim()).length; const bar = document.querySelector('.guide-panel progress'); if (bar) { bar.value = count; document.querySelector('.guide-panel .guide-progress>span').textContent = count + '/' + QUESTIONS.length; } }
  else if (node.id === 'checkin-energy') { state.drafts.checkin.en = Number(node.value); document.getElementById('checkin-energy-label').textContent = node.value; markDirty(); }
  else if (node.id === 'search') { query = node.value; updateTimelineList(); }
  else if (node.dataset.pref) { state.preferences[node.dataset.pref] = node.value; applyAppearance(); markDirty(); }
});
document.addEventListener('change', event => {
  if (!state) return;
  if (event.target.id === 'journal-filter') { journalFilter = event.target.value; updateTimelineList(); }
  if (event.target.id === 'dark-mode') { state.preferences.mode = event.target.checked ? 'dark' : 'light'; applyAppearance(); markDirty(); }
  if (event.target.id === 'import-file') { importFile(event.target.files[0]); event.target.value = ''; }
});
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action;
  try {
    if (action === 'modal-close') { if (busy) return; modal.close(); modalAction = null; modal.innerHTML = ''; return; }
    if (action === 'modal-confirm') {
      if (!modalAction || busy) return; busy = true; button.disabled = true;
      const cancelButton = modal.querySelector('[data-action="modal-close"]'); cancelButton.disabled = true;
      try { await modalAction(); if (modal.open) modal.close(); modal.innerHTML = ''; modalAction = null; }
      catch (error) { const errorNode = document.getElementById('modal-error'); if (errorNode) errorNode.textContent = error.message; else toast(error.message); }
      finally { busy = false; button.disabled = false; cancelButton.disabled = false; } return;
    }
    if (action === 'privacy') { privacyModal(); return; }
    if (action === 'auth-tab') { if (busy) return; rememberedEmail = document.getElementById('auth-email').value; authView = button.dataset.view; renderAuth(); return; }
    if (action === 'show-password') { const input = document.getElementById(button.dataset.target); input.type = input.type === 'password' ? 'text' : 'password'; button.setAttribute('aria-label', input.type === 'password' ? 'Show passphrase' : 'Hide passphrase'); return; }
    if (!state || !vaultKey) return;
    if (action === 'navigate') {
      if (editingId && page !== button.dataset.page) { toast('Save or cancel your edit before leaving this page.'); return; }
      page = button.dataset.page; render(); window.scrollTo({top:0,behavior:'smooth'});
    } else if (action === 'mood') {
      const draft = button.dataset.target === 'checkin' ? state.drafts.checkin : editingId ? editDraft : state.drafts.entry;
      draft.m = Number(button.dataset.value); for (const option of button.parentElement.children) { const selected = option === button; option.classList.toggle('selected',selected); option.setAttribute('aria-pressed',String(selected)); }
      markDirty();
    } else if (action === 'tag') {
      const draft = editingId ? editDraft : state.drafts.entry, tag = button.dataset.tag;
      draft.g = draft.g.includes(tag) ? draft.g.filter(x => x !== tag) : [...draft.g,tag]; button.classList.toggle('selected',draft.g.includes(tag)); button.setAttribute('aria-pressed',String(draft.g.includes(tag))); markDirty();
    } else if (action === 'next-prompt') { promptIndex = (promptIndex + 1) % DAILY_PROMPTS.length; document.getElementById('daily-prompt').textContent = DAILY_PROMPTS[promptIndex]; }
    else if (action === 'quick-log') await submitEntry(true);
    else if (action === 'favorite') { const id = button.dataset.id; state.favorites = state.favorites.includes(id) ? state.favorites.filter(x => x !== id) : [...state.favorites,id]; markDirty(); render(); }
    else if (action === 'edit') {
      const entry = state.e.find(e => e.id === button.dataset.id); if (!entry) return;
      if (entry.kind === 'checkin' && Object.keys(entry.answers).length) {
        if (Object.values(state.drafts.checkin.answers).some(v => v.trim())) { toast('Save your unfinished reflection before editing another.'); return; }
        state.drafts.checkin = {date:entry.d,answers:structuredClone(entry.answers),m:entry.m,en:entry.en,step:0,editingId:entry.id};
        // Editing a reflection replaces its original entry only when the user saves it.
        markDirty(); page = 'reflect'; render();
      } else { editingId = entry.id; editDraft = {t:entry.t,title:entry.title,m:entry.m,en:entry.en,g:[...entry.g],j:entry.j}; state.drafts.edit = {id:editingId,value:editDraft}; markDirty(); page = 'today'; render(); }
      window.scrollTo({top:0,behavior:'smooth'});
    } else if (action === 'cancel-edit') { editingId = null; editDraft = null; state.drafts.edit = null; markDirty(); render(); }
    else if (action === 'cancel-guide-edit') { state.drafts.checkin = checkinDraft(); markDirty(); render(); }
    else if (action === 'delete-entry') {
      const id = button.dataset.id; showModal('Let this moment go?', '<p>This removes the entry from your diary. Previous backups may still contain it.</p>', 'Delete entry', async () => { deleteEntry(state,id); if (editingId === id) { editingId = null; editDraft = null; } markDirty(); render(); await saveFeedback('The entry was removed.'); }, true);
    } else if (action === 'select-day') { selectedDay = button.dataset.day; query = ''; page = 'timeline'; render(); }
    else if (action === 'all-days') { selectedDay = ''; query = ''; render(); }
    else if (action === 'month') { calendarMonth = new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+Number(button.dataset.value),1); selectedDay = iso(calendarMonth); render(); }
    else if (action === 'guide-step') { state.drafts.checkin.step = Number(button.dataset.step); markDirty(); render(); window.scrollTo({top:0,behavior:'smooth'}); }
    else if (action === 'guide-save') {
      saveCheckin(state);
      markDirty(); page = 'today'; render(); await saveFeedback('Your reflection is safely kept.');
    } else if (action === 'claim') { if (claimQuest(state,button.dataset.id)) { markDirty(); render(); await saveFeedback('A little milestone, acknowledged.'); } }
    else if (action === 'avatar') { state.preferences.avatar = button.dataset.value; markDirty(); render(); }
    else if (action === 'retry-save') { if (conflicted) toast('Download a protected backup, then reopen the diary.'); else { saveError = ''; if (await flushSave()) { render(); toast('Your diary is saved.'); } else { render(); toast(saveError); } } }
    else if (action === 'backup') await backup();
    else if (action === 'export') showModal('Download a readable copy?', '<p>This export contains your writing without encryption. Anyone who can open the file can read it. Store it somewhere private.</p>', 'Download readable copy', () => { download({kind:'ember-readable-export',exportedAt:new Date().toISOString(),...state},'ember-readable-diary-' + iso() + '.json'); });
    else if (action === 'pending-backup') { download({kind:'ember-encrypted-backup',format:1,accountId:user.id,salt:pendingRecovery.salt || user.salt,vault:pendingRecovery.vault},'ember-recovery-' + iso() + '.json'); }
    else if (action === 'dismiss-pending') showModal('Remove the recovery copy?', '<p>Download it first if it contains moments you want to keep. This does not remove your server diary.</p>', 'Remove recovery copy', () => { localStorage.removeItem(pendingRecoveryStorageKey); pendingRecovery = null; pendingRecoveryStorageKey = ''; findOtherRecovery(); render(); },true);
    else if (action === 'reopen') showModal('Reopen your saved diary?', '<p>Download a protected backup first. Unsaved changes in this open view will not replace the newer server diary. A separate recovery copy will remain available.</p>', 'Lock & reopen', async () => { await protectPending(structuredClone(state)); generation = savedGeneration; await lockDiary(); });
    else if (action === 'lock') await lockDiary();
    else if (action === 'logout') await lockDiary(true);
    else if (action === 'reminder') {
      if (state.preferences.reminders) state.preferences.reminders = false;
      else { if (!('Notification' in window)) throw new Error('Notifications are not available in this browser.'); const permission = await Notification.requestPermission(); if (permission !== 'granted') throw new Error('Notification permission was not granted.'); state.preferences.reminders = true; }
      markDirty(); render();
    } else if (action === 'clear-diary') showModal('Start with a fresh diary?', '<p>All entries, reflection answers, drafts, and progress will be removed from this account. Keep a backup first if you want to return to them.</p>', 'Clear my diary', async () => { const preferences = state.preferences; state = emptyState(); state.preferences = preferences; editingId = null; editDraft = null; markDirty(); if (!(await flushSave())) throw new Error(saveError || 'The diary could not be cleared.'); try { for (const key of Object.keys(localStorage)) if (key.startsWith('ember_pending_' + user.id + '_')) localStorage.removeItem(key); pendingRecovery = null; } catch {} render(); toast('Your diary is now a fresh page.'); },true);
    else if (action === 'change-password') showModal('Change your passphrase', '<p>Your diary will be encrypted again with the new passphrase. Other sessions will be signed out.</p><div class="field"><label for="current-password">Current passphrase</label><input id="current-password" type="password" autocomplete="current-password" maxlength="256"></div><div class="field"><label for="new-password">New passphrase (at least 12 characters)</label><input id="new-password" type="password" autocomplete="new-password" minlength="12" maxlength="256"></div><div class="field"><label for="new-confirm">Confirm new passphrase</label><input id="new-confirm" type="password" autocomplete="new-password" maxlength="256"></div>', 'Change passphrase', async () => {
      const current = document.getElementById('current-password').value, next = document.getElementById('new-password').value;
      if (next.length < 12 || next !== document.getElementById('new-confirm').value) throw new Error('Use at least 12 characters and a matching confirmation.');
      if (!(await flushSave())) throw new Error(saveError || 'Save your diary before changing the passphrase.');
      const previous = await deriveSecrets(current,user.salt), salt = newSalt(), secrets = await deriveSecrets(next,salt), vault = await encryptVault(state,secrets.key,user.id);
      const result = await api('/auth/password','POST',{credential:previous.credential,newCredential:secrets.credential,salt,vault,revision});
      vaultKey = secrets.key; user = result.user; csrf = result.csrf; revision = result.revision; try { localStorage.removeItem(pendingKey()); } catch {} toast('Your new passphrase is ready. Older backups still use their original passphrase.');
    });
    else if (action === 'delete-account') showModal('Delete your account and diary?', '<p>This permanently removes your account and encrypted diary from this server. Copies in independent backups are not removed. Confirm with your passphrase.</p><div class="field"><label for="delete-password">Current passphrase</label><input id="delete-password" type="password" autocomplete="current-password" maxlength="256"></div>', 'Delete account permanently', async () => {
      const secrets = await deriveSecrets(document.getElementById('delete-password').value,user.salt);
      clearTimeout(saveTimer); if (saving) await saving;
      await api('/auth/account','DELETE',{credential:secrets.credential});
      try { for (const key of Object.keys(localStorage)) if (key.startsWith('ember_pending_' + user.id + '_')) localStorage.removeItem(key); } catch {}
      vaultKey = null; state = null; user = null; csrf = ''; rememberedEmail = ''; clearTimeout(idleTimer); renderAuth(); toast('Your account and diary were deleted.');
    },true);
  } catch (error) { toast(error.message); }
});
for (const event of ['pointerdown','keydown','input']) document.addEventListener(event,resetIdle,{passive:true});
modal.addEventListener('cancel', event => { if (busy) { event.preventDefault(); return; } modalAction = null; setTimeout(() => { modal.innerHTML = ''; },0); });
window.addEventListener('beforeunload', event => { if (state && generation > savedGeneration) { event.preventDefault(); event.returnValue = ''; } });
function checkReminder() {
  if (!state || !vaultKey || !state.preferences.reminders || !('Notification' in window) || Notification.permission !== 'granted') return;
  const key = iso() + ' ' + state.preferences.reminderAt;
  if (new Date().toTimeString().slice(0,5) === state.preferences.reminderAt && state.preferences.lastReminder !== key && !state.e.some(e => e.d === iso())) { new Notification('A little space for yourself?',{body:'Your journal is ready whenever you are.'}); state.preferences.lastReminder = key; markDirty(); }
}
setInterval(checkReminder,30000); document.addEventListener('visibilitychange',checkReminder);
setTimeout(() => document.getElementById('launch')?.remove(),1500);
async function boot() {
  if (!crypto.subtle) { renderAuth('Open Ember on HTTPS or localhost so your diary can be encrypted.'); document.getElementById('auth-submit').disabled = true; return; }
  try { const session = await api('/auth/session'); rememberedEmail = session.user.email; }
  catch (error) { if (error.status !== 401) { renderAuth(error.message); return; } }
  renderAuth();
}
boot();
