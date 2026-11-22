// Lancer avec :  node --test tests/engine.test.js
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine.js');

// Fabrique une séance factice : mêmes douleurs pour les 3 exos
function session(i, loads, { during = 2, next = 1, reps = null, sets = null, week = 0 } = {}) {
  const w = E.DEFAULT_PROGRAM.weeks[week];
  const entries = {};
  for (const ex of E.DEFAULT_PROGRAM.exercises) {
    entries[ex.id] = { load: loads[ex.id], repsDone: reps ?? w.reps, setsDone: sets ?? w.sets };
  }
  return { id: 's' + i, date: `2026-11-${String(i + 1).padStart(2, '0')}`, entries,
           painDuring: { L: during, R: 0 }, painNextDay: next === null ? null : { L: next, R: 0 } };
}

// Joue n séances "parfaites" en suivant à chaque fois les charges proposées
function playPerfect(st, n) {
  for (let i = 0; i < n; i++) {
    const pos = E.replay(st);
    st.sessions.push(session(st.sessions.length, pos.loads, { week: pos.week }));
  }
  return E.replay(st);
}

const start = { press: 80, squat: 30, hack: 40 };

test('Epley : 100 kg x 10 reps -> 1RM ≈ 133 kg', () => {
  assert.strictEqual(Math.round(E.e1rm(100, 10)), 133);
});

test('feu tricolore', () => {
  const p = E.DEFAULT_PROGRAM;
  assert.strictEqual(E.sessionVerdict({ painDuring: { L: 4, R: 3 }, painNextDay: { L: 2, R: 1 } }, p), 'green');
  assert.strictEqual(E.sessionVerdict({ painDuring: { L: 5, R: 3 }, painNextDay: { L: 4, R: 1 } }, p), 'orange');
  assert.strictEqual(E.sessionVerdict({ painDuring: { L: 3, R: 7 }, painNextDay: null }, p), 'red');
});

test('séance verte : la charge NE monte PAS pendant la semaine', () => {
  const st = E.newState(start);
  const pos = playPerfect(st, 2);
  assert.deepStrictEqual(pos.loads, start);
  assert.strictEqual(pos.week, 0);
});

test('2 reps de plus que le RM -> + 1 pas (charge trop légère)', () => {
  const st = E.newState(start);
  st.sessions.push(session(0, start, { reps: 17 }));
  const pos = E.replay(st);
  assert.strictEqual(pos.loads.hack, 42.5);
  assert.strictEqual(pos.loads.press, 85);
});

test('semaine 1 -> 2 : 15 RM -> 12 RM, charge recalculée (40 kg -> 42,5 kg)', () => {
  const st = E.newState(start);
  const pos = playPerfect(st, 3);
  assert.strictEqual(pos.week, 1);
  // 1RM = 40 x 1,5 = 60 ; 60 / 1,4 = 42,86 -> 42,5
  assert.strictEqual(pos.loads.hack, 42.5);
});

test('semaine 2 -> 3 : même RM (12), + 1 pas', () => {
  const st = E.newState(start);
  const pos = playPerfect(st, 6);
  assert.strictEqual(pos.week, 2);
  assert.strictEqual(pos.loads.hack, 45);
});

test('programme complet : progression régulière, sans emballement', () => {
  const st = E.newState(start);
  const perWeek = [];
  for (let w = 0; w < 12; w++) { perWeek.push(E.replay(st).loads.hack); playPerfect(st, 3); }
  const end = E.replay(st);
  assert.ok(end.finished);
  assert.deepStrictEqual(perWeek, [40, 42.5, 45, 47.5, 50, 52.5, 55, 57.5, 60, 62.5, 65, 67.5]);
  for (let i = 1; i < perWeek.length; i++) assert.ok(perWeek[i] - perWeek[i - 1] <= 5, 'jamais plus de 5 kg d\'une semaine à l\'autre');
});

test('séries incomplètes -> on prolonge la semaine, même charge', () => {
  const st = E.newState(start);
  for (let i = 0; i < 3; i++) st.sessions.push(session(i, start, { reps: 13 }));
  const pos = E.replay(st);
  assert.strictEqual(pos.week, 0);
  assert.strictEqual(pos.history[2].weekDecision, 'repeat');
  assert.strictEqual(pos.loads.hack, 40);
});

test('douleur rouge en semaine 2 -> -10 % puis retour en semaine 1', () => {
  const st = E.newState(start);
  playPerfect(st, 4);                                  // 3 séances S1 + 1 séance S2
  const l = E.replay(st).loads;
  st.sessions.push(session(4, l, { week: 1, during: 7 }));
  const afterRed = E.replay(st);
  assert.strictEqual(afterRed.loads.squat, E.roundTo(l.squat * 0.9, 2.5));
  st.sessions.push(session(5, afterRed.loads, { week: 1 }));
  const back = E.replay(st);
  assert.strictEqual(back.week, 0);
  assert.ok(back.loads.hack <= afterRed.loads.hack, 'on ne monte pas en reculant');
});

test('lendemain en attente', () => {
  const st = E.newState(start);
  st.sessions.push(session(0, start, { next: null }));
  assert.ok(E.pendingNextDay(st, '2026-11-02'));
  assert.strictEqual(E.pendingNextDay(st, '2026-11-01'), null);
});
