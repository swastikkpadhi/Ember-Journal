import { QUESTIONS, QUESTION_VERSION } from './questions.js';

export const MOODS = ['Very low', 'Low', 'Steady', 'Good', 'Great'];
export const MOOD_FACES = ['😞', '😕', '😐', '🙂', '😄'];
export const TAGS = ['Work', 'Family', 'Movement', 'Rest', 'Friends', 'Outdoors', 'Stress', 'Creativity', 'Quiet'];
export const JOURNALS = [{ id: 'j1', t: 'Personal' }, { id: 'j2', t: 'Work' }, { id: 'j3', t: 'Mood notes' }];
export const BADGES = [
  { id: 'first', label: 'First page', icon: 'leaf', test: s => s.e.length >= 1 },
  { id: 's3', label: 'Three gentle days', icon: 'sun', test: s => s.best >= 3 },
  { id: 's7', label: 'A week of care', icon: 'spark', test: s => s.best >= 7 },
  { id: 's30', label: 'Thirty days', icon: 'moon', test: s => s.best >= 30 },
  { id: 'e10', label: 'Ten little stories', icon: 'book', test: s => s.e.length >= 10 },
  { id: 'e50', label: 'Fifty pages', icon: 'book', test: s => s.e.length >= 50 },
  { id: 'l5', label: 'Growing gently', icon: 'leaf', test: s => s.xp >= 400 }
];
export function iso(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function addDate(day, amount) { const date = new Date(day + 'T12:00:00'); date.setDate(date.getDate() + amount); return iso(date); }
export function weekStart(day = iso()) { const date = new Date(day + 'T12:00:00'); return addDate(day, -((date.getDay() + 6) % 7)); }
export const wordCount = text => String(text || '').trim().split(/\s+/).filter(Boolean).length;
export const level = state => Math.floor(state.xp / 100) + 1;
const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const text = (value, length = 60000) => typeof value === 'string' ? value.slice(0, length) : '';
const mood = value => Math.round(number(value, 3, 1, 5));
const validDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && iso(new Date(value + 'T12:00:00')) === value;
export function entryDraft() { return { t: '', title: '', m: 3, en: 50, g: [], j: 'j1' }; }
export function checkinDraft() { return { date: iso(), answers: {}, m: 3, en: 50, step: 0, editingId: null }; }
export function emptyState(name = '') {
  return { schema: 2, j: structuredClone(JOURNALS), e: [], xp: 0, best: 0, b: [], fz: 0, shieldEarned: false, uf: [], cl: {}, favorites: [],
    preferences: { name, avatar: '🌿', mode: 'light', font: 'serif', reminders: false, reminderAt: '20:30', lastReminder: '' }, drafts: { entry: entryDraft(), checkin: checkinDraft(), edit: null } };
}
export function normalizeEntry(value) {
  if (!value || typeof value !== 'object' || !validDay(value.d)) return null;
  const answers = {};
  for (const question of QUESTIONS) if (typeof value.answers?.[question.id] === 'string') answers[question.id] = text(value.answers[question.id], 6000);
  return { id: text(value.id, 80) || crypto.randomUUID(), title: text(value.title, 120), t: text(value.t), j: text(value.j, 80) || 'j1', m: mood(value.m), en: number(value.en, 50, 0, 100),
    g: Array.isArray(value.g) ? [...new Set(value.g.filter(x => typeof x === 'string').map(x => text(x, 40)))].slice(0, 12) : [], d: value.d,
    ts: number(value.ts, Date.now(), 0, 8640000000000000), q: !!value.q, x: number(value.x, 0, 0, 20), kind: value.kind === 'checkin' ? 'checkin' : 'entry', answers, questionsVersion: QUESTION_VERSION,
    ...(value.editedAt ? { editedAt: number(value.editedAt, Date.now(), 0, 8640000000000000) } : {}) };
}
export function normalizeState(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.e)) throw new Error('This file does not contain a compatible Ember diary.');
  const state = emptyState();
  const seen = new Set();
  state.e = value.e.map(normalizeEntry).filter(Boolean).map(entry => { if (seen.has(entry.id)) entry.id = crypto.randomUUID(); seen.add(entry.id); return entry; });
  if (Array.isArray(value.j) && value.j.length) state.j = value.j.slice(0, 30).map(j => ({ id: text(j.id, 80) || crypto.randomUUID(), t: text(j.t, 80) || 'Journal' }));
  state.xp = number(value.xp, state.e.reduce((sum, e) => sum + e.x, 0), 0, Number.MAX_SAFE_INTEGER);
  state.best = number(value.best, 0, 0, 100000); state.fz = number(value.fz, 0, 0, 1); state.shieldEarned = !!value.shieldEarned;
  state.uf = Array.isArray(value.uf) ? value.uf.filter(validDay) : [];
  state.b = Array.isArray(value.b) ? value.b.filter(x => BADGES.some(b => b.id === x)) : [];
  state.favorites = Array.isArray(value.favorites) ? value.favorites.filter(id => seen.has(id)) : [];
  if (value.cl && typeof value.cl === 'object') for (const [key, claimed] of Object.entries(value.cl)) if (/^\d{4}-\d{2}-\d{2}q[123]$/.test(key) && claimed) state.cl[key] = 1;
  const prefs = value.preferences || {};
  state.preferences = { name: text(prefs.name, 80), avatar: text(prefs.avatar || value.avatar, 12) || '🌿', mode: (prefs.mode || value.mode) === 'dark' ? 'dark' : 'light', font: ['serif', 'sans', 'mono'].includes(prefs.font) ? prefs.font : 'serif', reminders: !!prefs.reminders, reminderAt: /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(prefs.reminderAt || '') ? prefs.reminderAt : '20:30', lastReminder: text(prefs.lastReminder, 30) };
  if (value.drafts?.entry) {
    const d = value.drafts.entry;
    state.drafts.entry = { t: text(d.t), title: text(d.title, 120), m: mood(d.m), en: number(d.en, 50, 0, 100), g: Array.isArray(d.g) ? d.g.filter(x => TAGS.includes(x)) : [], j: state.j.some(j => j.id === d.j) ? d.j : state.j[0].id };
  }
  if (value.drafts?.checkin) {
    const d = value.drafts.checkin, answers = {};
    for (const q of QUESTIONS) if (typeof d.answers?.[q.id] === 'string') answers[q.id] = text(d.answers[q.id], 6000);
    state.drafts.checkin = { date: validDay(d.date) ? d.date : iso(), answers, m: mood(d.m), en: number(d.en, 50, 0, 100), step: Math.round(number(d.step, 0, 0, 4)), editingId: state.e.some(e => e.id === d.editingId && e.kind === 'checkin') ? d.editingId : null };
  }
  if (value.drafts?.edit && state.e.some(e => e.id === value.drafts.edit.id)) {
    const draft = value.drafts.edit.value;
    if (draft && typeof draft === 'object') state.drafts.edit = { id: value.drafts.edit.id, value: { t:text(draft.t), title:text(draft.title,120), m:Math.round(number(draft.m,3,1,5)), en:number(draft.en,50,0,100), g:Array.isArray(draft.g) ? draft.g.filter(t => typeof t === 'string').slice(0,12) : [], j:state.j.some(j => j.id === draft.j) ? draft.j : state.j[0].id } };
  }
  return state;
}
export function activeDays(state) { return new Set([...state.e.map(e => e.d), ...state.uf]); }
export function streak(state, day = iso()) { const dates = activeDays(state); let end = dates.has(day) ? day : addDate(day, -1), result = 0; while (dates.has(end)) { result++; end = addDate(end, -1); } return result; }
export function milestones(state) {
  for (const badge of BADGES) if (!state.b.includes(badge.id) && badge.test(state)) state.b.push(badge.id);
  if (state.best >= 7 && !state.shieldEarned) { state.shieldEarned = true; state.fz = 1; }
}
export function applyShield(state, day = iso()) {
  if (!state.fz) return false;
  const yesterday = addDate(day, -1), dates = activeDays(state), last = [...dates].filter(d => d <= yesterday).sort().pop();
  if (last && addDate(last, 2) === day) { state.uf.push(yesterday); state.fz = 0; return true; }
  return false;
}
export function addEntry(state, draft, quick = false, date = iso()) {
  if (!quick && !String(draft.t || '').trim()) throw new Error('Write a few words, or choose a mood check-in.');
  const had = activeDays(state).has(date);
  const entry = normalizeEntry({ ...draft, id: crypto.randomUUID(), t: quick ? '' : draft.t.trim(), d: date, ts: Date.now(), q: quick });
  state.e.push(entry); const current = streak(state, date); state.best = Math.max(state.best, current);
  entry.x = (quick ? 5 : 10) + (had ? 0 : Math.min(current, 10)); state.xp += entry.x; milestones(state); return entry;
}
export function saveCheckin(state) {
  const draft = state.drafts.checkin, answered = QUESTIONS.filter(q => draft.answers[q.id]?.trim());
  if (!answered.length) throw new Error('Answer any question you like before saving. Everything else can be skipped.');
  const fullText = answered.map(q => `${q.title}\n${draft.answers[q.id].trim()}`).join('\n\n');
  const original = draft.editingId && state.e.find(e => e.id === draft.editingId && e.kind === 'checkin');
  const entry = original || addEntry(state, { ...entryDraft(), t: fullText, title: 'A gentle look back', m: draft.m, en: draft.en, kind: 'checkin', answers: draft.answers }, false, draft.date);
  if (original) Object.assign(original, { t:fullText, m:draft.m, en:draft.en, answers:structuredClone(draft.answers), editedAt:Date.now() });
  state.drafts.checkin = checkinDraft(); return entry;
}
export function quests(state, day = iso()) {
  const monday = weekStart(day), entries = state.e.filter(e => e.d >= monday && e.d <= day);
  return [
    { id: 'q1', title: 'Keep five little moments', detail: 'Write an entry or log a mood five times this week.', progress: entries.length, target: 5, xp: 40 },
    { id: 'q2', title: 'Give your thoughts a little room', detail: 'Write 150 words across your entries this week.', progress: entries.reduce((n, e) => n + (e.kind === 'checkin' && Object.keys(e.answers || {}).length ? Object.values(e.answers).reduce((sum, answer) => sum + wordCount(answer), 0) : wordCount(e.t)), 0), target: 150, xp: 40 },
    { id: 'q3', title: 'Check in with yourself', detail: 'Save three quick mood check-ins this week.', progress: entries.filter(e => e.q).length, target: 3, xp: 30 }
  ];
}
export function claimQuest(state, id, day = iso()) {
  const quest = quests(state, day).find(q => q.id === id), key = weekStart(day) + id;
  if (!quest || quest.progress < quest.target || state.cl[key]) return false;
  state.cl[key] = 1; state.xp += quest.xp; milestones(state); return true;
}
export function deleteEntry(state, id) {
  state.e = state.e.filter(e => e.id !== id); state.favorites = state.favorites.filter(x => x !== id);
  if (state.drafts.edit?.id === id) state.drafts.edit = null;
  if (state.drafts.checkin.editingId === id) state.drafts.checkin = checkinDraft();
}
