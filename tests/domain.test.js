import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, normalizeState, addEntry, saveCheckin, deleteEntry, streak, applyShield, claimQuest, quests, weekStart, addDate } from '../domain.js';

test('drafts and zero energy survive normalization and existing-entry edits', () => {
  const state = emptyState('Sam');
  const entry = addEntry(state,{...state.drafts.entry,t:'My own words',en:0},false,'2026-10-10');
  state.drafts.entry.t='Unfinished private writing';
  state.drafts.checkin.answers.people='A friend at lunch';
  state.drafts.edit={id:entry.id,value:{...state.drafts.entry,t:'An unfinished edit',en:0}};
  const restored=normalizeState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.e[0].en,0);
  assert.equal(restored.drafts.entry.t,'Unfinished private writing');
  assert.equal(restored.drafts.checkin.answers.people,'A friend at lunch');
  assert.equal(restored.drafts.edit.value.en,0);
  assert.equal(restored.preferences.mode,'light');
});
test('streak dates use calendar arithmetic and shields cover exactly one missed day', () => {
  const state=emptyState();
  addEntry(state,{...state.drafts.entry,t:'Yesterday'},false,'2026-10-08');
  state.fz=1;assert.equal(applyShield(state,'2026-10-10'),true);
  assert.equal(state.fz,0);assert.equal(streak(state,'2026-10-10'),2);
  assert.equal(addDate('2026-12-31',1),'2027-01-01');
  assert.equal(weekStart('2026-10-11'),'2026-10-05');
  state.fz=1;assert.equal(applyShield(state,'2026-10-12'),false);
});
test('quest rewards require completion and cannot be claimed twice', () => {
  const state=emptyState();
  assert.equal(claimQuest(state,'q1','2026-10-10'),false);
  for(let i=0;i<5;i++)addEntry(state,{...state.drafts.entry,t:'A small moment'},false,'2026-10-10');
  const xp=state.xp;assert.equal(claimQuest(state,'q1','2026-10-10'),true);
  assert.equal(state.xp,xp+40);assert.equal(claimQuest(state,'q1','2026-10-10'),false);
  assert.equal(quests(state,'2026-10-10')[0].progress,5);
  assert.equal(new Set(state.e.map(e=>e.id)).size,5);
});
test('optional questionnaire answers are kept, and reflection edits preserve identity and XP', () => {
  const state=emptyState();
  assert.throws(()=>saveCheckin(state),/Answer any question/);
  state.drafts.checkin.answers.people='An old friend';
  state.drafts.checkin.answers.hard='';
  const original=saveCheckin(state),xp=state.xp;
  assert.equal(original.answers.people,'An old friend');
  state.favorites.push(original.id);
  state.drafts.checkin={date:original.d,answers:{people:'A kind neighbour'},m:4,en:0,step:2,editingId:original.id};
  const restored=normalizeState(state),updated=saveCheckin(restored);
  assert.equal(updated.id,original.id);assert.equal(restored.e.length,1);
  assert.equal(restored.xp,xp);assert.equal(updated.en,0);
  assert.equal(updated.answers.people,'A kind neighbour');
  restored.drafts.checkin={date:original.d,answers:{people:'Unfinished edit'},m:3,en:50,step:0,editingId:original.id};
  deleteEntry(restored,original.id);assert.deepEqual(restored.favorites,[]);
  assert.equal(restored.drafts.checkin.editingId,null);assert.deepEqual(restored.drafts.checkin.answers,{});
});
test('legacy exports normalize without duplicate identities or malformed records', () => {
  const state=normalizeState({e:[{id:'s1',t:'First',d:'2026-10-10',en:0,m:3.7},{id:'s1',t:'Second',d:'2026-10-10'},{d:'bad'},{d:'2026-02-30'}]});
  assert.equal(state.e.length,2);assert.equal(new Set(state.e.map(e=>e.id)).size,2);
  assert.equal(state.e[0].en,0);assert.ok(state.drafts.checkin);assert.equal(state.preferences.mode,'light');
  assert.equal(state.e[0].m,4);
});
test('questionnaire labels do not count toward writing rewards', () => {
  const state=emptyState();state.drafts.checkin.date='2026-10-10';state.drafts.checkin.answers.people='An old friend';
  saveCheckin(state);assert.equal(quests(state,'2026-10-10')[1].progress,3);
  state.drafts.edit={id:state.e[0].id,value:{t:'Unfinished'}};deleteEntry(state,state.e[0].id);
  assert.equal(state.drafts.edit,null);
});
