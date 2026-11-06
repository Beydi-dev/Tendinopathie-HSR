// Lancer avec :  node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine.js');

// Fabrique une séance factice : mêmes charges/douleurs pour les 3 exos
function session(i, loads, { during = 2, next = 1, reps = null, sets = null, week } = {}) {
  const w = E.DEFAULT_PROGRAM.weeks[week ?? 0];
  const entries = {};
  for (const ex of E.DEFAULT_PROGRAM.exercises) {
    entries[ex.id] = { load: loads[ex.id], repsDone: reps ?? w.reps, setsDone: sets ?? w.sets };
  }
  return { id: 's' + i, date: `2026-11-${String(i + 1).padStart(2, '0')}`, entries,
           painDuring: { L: during, R: 0 }, painNextDay: next === null ? null : { L: next, R: 0 } };
}

const start = { hack: 40, squat: 30, press: 80 };

test('Epley : 100 kg x 10 reps -> 1RM ≈ 133 kg', () => {
  assert.strictEqual(Math.round(E.e1rm(100, 10)), 133);
});

test('feu tricolore', () => {
  const p = E.DEFAULT_PROGRAM;
  assert.strictEqual(E.sessionVerdict({ painDuring: { L: 4, R: 3 }, painNextDay: { L: 2, R: 1 } }, p), 'green');
  assert.strictEqual(E.sessionVerdict({ painDuring: { L: 5, R: 3 }, painNextDay: { L: 4, R: 1 } }, p), 'orange');
  assert.strictEqual(E.sessionVerdict({ painDuring: { L: 3, R: 7 }, painNextDay: null }, p), 'red');
});

test('séance verte et complète -> +2,5 kg au hack', () => {
  const st = E.newState(start);
  st.sessions.push(session(0, start));
  const pos = E.replay(st);
  assert.strictEqual(pos.loads.hack, 42.5);
  assert.strictEqual(pos.loads.press, 85);
  assert.strictEqual(pos.sessionInWeek, 1);
});

test('3 séances vertes -> passage en semaine 2 avec charge recalculée', () => {
  const st = E.newState(start);
  let l = { ...start };
  for (let i = 0; i < 3; i++) { st.sessions.push(session(i, l)); l = E.replay(st).loads; }
  const pos = E.replay(st);
  assert.strictEqual(pos.week, 1);
  assert.strictEqual(pos.sessionInWeek, 0);
  assert.ok(pos.loads.hack >= 45, 'la charge ne baisse pas quand on avance');
});

test('séries incomplètes -> on prolonge la semaine', () => {
  const st = E.newState(start);
  for (let i = 0; i < 3; i++) st.sessions.push(session(i, start, { reps: 13 }));
  const pos = E.replay(st);
  assert.strictEqual(pos.week, 0);
  assert.strictEqual(pos.history[2].weekDecision, 'repeat');
});

test('douleur rouge en semaine 2 -> retour en semaine 1 et -10 %', () => {
  const st = E.newState(start);
  let l = { ...start };
  for (let i = 0; i < 3; i++) { st.sessions.push(session(i, l)); l = E.replay(st).loads; }
  st.sessions.push(session(3, l, { week: 1 }));
  l = E.replay(st).loads;
  st.sessions.push(session(4, l, { week: 1, during: 7 }));
  const afterRed = E.replay(st);
  assert.strictEqual(afterRed.loads.squat, E.roundTo(l.squat * 0.9, 2.5));
  st.sessions.push(session(5, afterRed.loads, { week: 1 }));
  assert.strictEqual(E.replay(st).week, 0);
});

test('lendemain en attente', () => {
  const st = E.newState(start);
  st.sessions.push(session(0, start, { next: null }));
  assert.ok(E.pendingNextDay(st, '2026-11-02'));
  assert.strictEqual(E.pendingNextDay(st, '2026-11-01'), null);
});
