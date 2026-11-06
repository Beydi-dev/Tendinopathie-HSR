/* =====================================================================
 * app.js — l'interface et la sauvegarde
 * ---------------------------------------------------------------------
 * Organisation :
 *   1. Storage  : lire / écrire les données (compte Claude ou téléphone)
 *   2. État     : les variables en mémoire
 *   3. Rendu    : fabriquer le HTML de chaque écran à partir de l'état
 *   4. Actions  : réagir aux clics, modifier l'état, sauvegarder, re-rendre
 * Règle d'or : on ne modifie JAMAIS l'écran directement. On modifie
 * l'état, puis on appelle render(). L'écran est toujours le reflet de l'état.
 * ===================================================================== */

/* ---------- 1. STORAGE ---------- */
const Storage = (() => {
  const LS_KEY = 'genou-hsr-v1';
  let ref = null;                     // référence vers le document en base, si dispo
  let queue = Promise.resolve();      // file d'attente : une écriture à la fois

  const lsGet = () => { try { const t = localStorage.getItem(LS_KEY); return t ? JSON.parse(t) : null; } catch { return null; } };
  const lsSet = (s) => { try { localStorage.setItem(LS_KEY, JSON.stringify(s)); } catch { /* stockage bloqué : tant pis */ } };
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

  // Tente de se connecter à la base privée liée au compte Claude
  async function connect() {
    if (!window.claude || !window.claude.use) return false;
    try {
      const [db, user] = await timeout(Promise.all([claude.use('db'), claude.use('user')]), 10000);
      if (!db || !user) return false;
      const id = await user.id();
      ref = db.doc(`data/users/${id}/main`);   // dossier privé : personne d'autre ne le lit
      return true;
    } catch { return false; }
  }

  async function load() {
    const local = lsGet();
    if (await connect()) {
      try {
        const snap = await timeout(ref.get(), 10000);
        if (snap.exists) { const data = JSON.parse(JSON.stringify(snap.data())); lsSet(data); return { state: data, where: 'cloud' }; }
        if (local) save(local);           // première connexion : on remonte les données du téléphone
        return { state: local, where: 'cloud' };
      } catch { ref = null; }
    }
    return { state: local, where: 'local' };
  }

  function save(state) {
    lsSet(state);
    if (!ref) return Promise.resolve(true);
    const copy = JSON.parse(JSON.stringify(state));
    queue = queue.then(() => ref.set(copy)).then(() => true, () => false);
    return queue;
  }

  return { load, save };
})();

/* ---------- 2. ÉTAT EN MÉMOIRE ---------- */
let state = null;          // données sauvegardées (programme + séances)
let pos = null;            // position calculée par Engine.replay(state)
let draft = null;          // séance en cours de saisie (pas encore enregistrée)
let nextDraft = { L: null, R: null };  // douleur du lendemain en cours de saisie
let where = 'local';
const ui = { tab: 'seance', confirm: null, exportOpen: false, loading: true };

const today = () => new Date().toLocaleDateString('sv-SE');   // format AAAA-MM-JJ
const fmtDate = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const kg = (n) => (Math.round(n * 10) / 10).toString().replace('.', ',');

// Recalcule tout ce qui dépend des données
function refresh() {
  pos = Engine.replay(state);
  draft = { ...Engine.todaySession(state, pos), painDuring: { L: null, R: null }, note: '' };
}

/* ---------- 3. RENDU ---------- */
const $root = () => document.getElementById('app');

function render() {
  const el = $root();
  if (ui.loading) { el.innerHTML = `<div class="wrap"><h1>Genoux HSR</h1><p class="muted">Chargement de ton suivi…</p></div>`; return; }
  const body = !state ? viewSetup()
    : ui.tab === 'seance' ? viewSession()
    : ui.tab === 'evolution' ? viewEvolution()
    : viewProgram();
  el.innerHTML = `<div class="wrap">${state ? viewHeader() : ''}${body}</div>${state ? viewTabs() : ''}`;
}

function viewHeader() {
  const total = state.program.weeks.length;
  const cells = state.program.weeks.map((_, i) =>
    `<span class="${i < pos.week || pos.finished ? 'done' : i === pos.week ? 'now' : ''}"></span>`).join('');
  return `<header class="head">
    <div class="head-row">
      <h1>Semaine <span class="num">${pos.week + 1}</span><span class="muted" style="font-size:20px"> / ${total}</span></h1>
      <span class="label">Séance ${pos.sessionInWeek + 1} / ${state.program.sessionsPerWeek}${pos.blockRepeats ? ` · prolongée ×${pos.blockRepeats}` : ''}</span>
    </div>
    <div class="weeks" aria-label="Progression sur ${total} semaines">${cells}</div>
  </header>`;
}

function viewTabs() {
  const t = (id, label) => `<button data-action="tab" data-tab="${id}" ${ui.tab === id ? 'aria-current="page"' : ''}>${label}</button>`;
  return `<nav class="tabs">${t('seance', 'Séance')}${t('evolution', 'Évolution')}${t('programme', 'Programme')}</nav>`;
}

// Premier lancement : saisir les charges de départ
function viewSetup() {
  const ex = Engine.DEFAULT_PROGRAM.exercises;
  const ex0 = { hack: 40, squat: 30, press: 80 };
  return `<h1>Genoux HSR</h1>
  <p class="muted">Suivi de ta rééducation des tendons rotuliens : 3 exercices, 12 semaines, la charge monte pendant que les répétitions baissent. L'app calcule la séance du jour et décide si tu avances, prolonges ou recules selon ta douleur.</p>
  <section class="card">
    <h2>Charges de départ</h2>
    <p class="note">Une charge que tu peux soulever 15 fois, lentement, avec une douleur ≤ 5/10. <span class="example">Valeurs d'exemple</span></p>
    ${ex.map((e) => `<label class="field"><span class="label">${e.name} (kg)</span>
      <input type="number" inputmode="decimal" step="${e.step}" min="0" id="start-${e.id}" value="${ex0[e.id]}"></label>`).join('')}
    <button class="btn" data-action="start">Commencer le programme</button>
  </section>
  <p class="note">Cet outil t'aide à suivre ton programme ; il ne remplace pas l'avis de ton kiné ou de ton médecin.</p>`;
}

function stepper(exId, field, value, label, big) {
  const show = field === 'load' ? kg(value) : value;
  return `<div class="field${big ? ' big' : ''}"><span class="label">${label}</span>
    <div class="stepper">
      <button data-action="step" data-ex="${exId}" data-field="${field}" data-delta="-1" aria-label="${label} moins">−</button>
      <output>${show}</output>
      <button data-action="step" data-ex="${exId}" data-field="${field}" data-delta="1" aria-label="${label} plus">+</button>
    </div></div>`;
}

// zone de couleur d'une note de douleur, selon les seuils du programme
function zone(v, kind) {
  const p = state.program;
  if (v >= p.painStepBack) return 'z3';
  const limit = kind === 'next' ? p.painMaxNextDay : p.painMaxDuring;
  return v <= limit ? 'z1' : 'z2';
}

function painScale(target, knee, current, kind) {
  const btns = Array.from({ length: 11 }, (_, v) =>
    `<button data-action="pain" data-target="${target}" data-knee="${knee}" data-v="${v}" class="${zone(v, kind)}" aria-pressed="${current === v}">${v}</button>`).join('');
  return `<div class="pain"><span class="label">Genou ${knee === 'L' ? 'gauche' : 'droit'}</span><div class="pain-row" role="group">${btns}</div></div>`;
}

function viewPending(pending) {
  return `<section class="card">
    <span class="label">Après la séance du ${fmtDate(pending.date)}</span>
    <h2>Ce matin, tes genoux ?</h2>
    <p class="note">Douleur au réveil ou en descendant un escalier. C'est cette note qui décide si tu peux monter.</p>
    ${painScale('next', 'L', nextDraft.L, 'next')}
    ${painScale('next', 'R', nextDraft.R, 'next')}
    <div class="scale-hint"><span>0 aucune</span><span>10 maximale</span></div>
    <button class="btn" data-action="save-next" ${nextDraft.L === null || nextDraft.R === null ? 'disabled' : ''}>Enregistrer</button>
  </section>`;
}

function viewSession() {
  if (pos.finished) return viewAdvice() + `<section class="card"><p>Programme terminé. Tu peux exporter tes données dans l'onglet Programme.</p></section>`;
  const pending = Engine.pendingNextDay(state, today());
  if (pending) return viewPending(pending);

  const exCards = state.program.exercises.map((ex) => {
    const e = draft.entries[ex.id];
    return `<section class="card">
      <div class="ex-top"><h3>${ex.name}</h3><span class="target">${draft.sets} × ${draft.reps} · 3 s / 3 s</span></div>
      <div class="fields">
        ${stepper(ex.id, 'load', e.load, 'Charge kg', true)}
        ${stepper(ex.id, 'setsDone', e.setsDone, 'Séries')}
        ${stepper(ex.id, 'repsDone', e.repsDone, 'Reps dern.')}
      </div>
    </section>`;
  }).join('');

  const ready = draft.painDuring.L !== null && draft.painDuring.R !== null;
  return `${viewAdvice()}
  ${exCards}
  <section class="card">
    <h2>Douleur pendant la séance</h2>
    <p class="note">La plus forte ressentie. Jusqu'à ${state.program.painMaxDuring}/10, c'est acceptable.</p>
    ${painScale('during', 'L', draft.painDuring.L, 'during')}
    ${painScale('during', 'R', draft.painDuring.R, 'during')}
    <div class="scale-hint"><span>0 aucune</span><span>10 maximale</span></div>
  </section>
  <button class="btn" data-action="save-session" ${ready ? '' : 'disabled'}>${ready ? 'Enregistrer la séance' : 'Note ta douleur pour enregistrer'}</button>
  <p class="note">Pré-rempli avec ce qui est prévu : corrige seulement ce qui diffère. « Reps dern. » = répétitions faites à la dernière série. Sauvegarde : ${where === 'cloud' ? 'ton compte Claude' : 'ce téléphone'}.</p>`;
}

function viewAdvice() {
  const a = Engine.advice(state, pos);
  return `<section class="advice tone-${a.tone}"><h3>${a.title}</h3><p>${a.text}</p></section>`;
}

/* --- Graphique en lignes, dessiné à la main en SVG --- */
function lineChart(series, { yMax, unit = '', ref = null, height = 170 }) {
  const W = 340, H = height, L = 30, R = 8, T = 10, B = 22;
  const n = Math.max(...series.map((s) => s.values.length), 1);
  const x = (i) => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - v / yMax);
  const ticks = [0, yMax / 2, yMax].map((v) =>
    `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/>
     <text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${Math.round(v)}${unit}</text>`).join('');
  const refLine = ref === null ? '' :
    `<line x1="${L}" x2="${W - R}" y1="${y(ref)}" y2="${y(ref)}" stroke="var(--red)" stroke-dasharray="3 3" stroke-width="1"/>`;
  const lines = series.map((s) => {
    const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v)])).filter(Boolean);
    if (!pts.length) return '';
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const last = pts[pts.length - 1];
    return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" ${s.dash ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="3.5" fill="${s.color}"/>`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${ticks}${refLine}${lines}
    <text x="${L}" y="${H - 6}">séance 1</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${n}</text></svg>`;
}

function viewEvolution() {
  const S = state.sessions;
  if (!S.length) return `<section class="card"><h2>Évolution</h2><p class="muted">Tes courbes de charge et de douleur apparaîtront ici après ta première séance.</p></section>`;
  const colors = ['var(--accent)', 'var(--ink)', 'var(--amber)'];
  const exs = state.program.exercises;
  const maxLoad = Math.max(...S.flatMap((s) => exs.map((e) => s.entries[e.id]?.load || 0)));
  const loadChart = lineChart(exs.map((e, i) => ({ color: colors[i], values: S.map((s) => s.entries[e.id]?.load ?? null) })),
    { yMax: Math.ceil((maxLoad * 1.1) / 10) * 10 || 10 });
  const painChart = lineChart([
    { color: 'var(--accent)', values: S.map((s) => s.painDuring.L) },
    { color: 'var(--ink)', values: S.map((s) => s.painDuring.R) },
    { color: 'var(--accent)', dash: true, values: S.map((s) => s.painNextDay?.L ?? null) },
    { color: 'var(--ink)', dash: true, values: S.map((s) => s.painNextDay?.R ?? null) },
  ], { yMax: 10, ref: state.program.painMaxDuring });

  const label = { advance: 'Semaine suivante', repeat: 'Semaine prolongée', back: 'Semaine précédente' };
  const hist = [...pos.history].reverse().map((h) => {
    const s = S.find((x) => x.id === h.id);
    const loads = exs.map((e) => kg(s.entries[e.id]?.load ?? 0)).join(' · ');
    const p = `${Math.max(s.painDuring.L, s.painDuring.R)}${s.painNextDay ? ` → ${Math.max(s.painNextDay.L, s.painNextDay.R)}` : ''}`;
    return `<div class="hist-item"><span class="dot ${h.verdict}"></span>
      <div><strong>${fmtDate(h.date)}</strong> <span class="muted">· S${h.week + 1}</span><br><span class="num" style="font-size:13px">${loads} kg · douleur ${p}</span></div>
      ${h.weekDecision ? `<span class="chip ${h.weekDecision}">${label[h.weekDecision]}</span>` : ''}</div>`;
  }).join('');

  return `<section class="card"><h2>Charges</h2>
    <div class="legend">${exs.map((e, i) => `<span><i style="background:${colors[i]}"></i>${e.name}</span>`).join('')}</div>
    ${loadChart}</section>
  <section class="card"><h2>Douleur</h2>
    <div class="legend"><span><i style="background:var(--accent)"></i>Gauche</span><span><i style="background:var(--ink)"></i>Droit</span>
      <span class="muted">trait plein : pendant · pointillés : lendemain · rouge : seuil ${state.program.painMaxDuring}/10</span></div>
    ${painChart}</section>
  <section class="card"><h2>Historique</h2>
    <p class="note">Pastille : vert = progression, orange = on garde, rouge = on recule. Douleur : pendant → lendemain.</p>
    <div class="hist">${hist}</div>
    ${ui.confirm === 'delete'
      ? `<div class="row"><button class="btn danger" data-action="delete-last">Supprimer la séance du ${fmtDate(S[S.length - 1].date)}</button><button class="btn ghost" data-action="cancel">Annuler</button></div>`
      : `<button class="btn ghost" data-action="ask" data-what="delete">Supprimer la dernière séance</button>`}
  </section>`;
}

function viewProgram() {
  const p = state.program;
  const rows = p.weeks.map((w, i) => `<tr class="${i === pos.week ? 'now' : ''}"><td>Semaine ${i + 1}</td><td class="num">${w.sets} × ${w.reps}</td><td class="num">${Math.round(100 / (1 + w.reps / 30))} %</td></tr>`).join('');
  const thr = (id, label, v) => `<label class="field"><span class="label">${label}</span><input type="number" min="0" max="10" id="${id}" data-action="threshold" value="${v}"></label>`;
  return `<section class="card"><h2>${p.name}</h2>
    <p class="note">${p.sessionsPerWeek} séances par semaine, 48 h entre deux. % = part du 1RM estimé correspondant à ces répétitions.</p>
    <div class="table-scroll"><table><thead><tr><th>Bloc</th><th class="num">Séries × reps</th><th class="num">% 1RM</th></tr></thead><tbody>${rows}</tbody></table></div>
  </section>
  <section class="card"><h2>Règles de douleur</h2>
    <p class="note">Si ton kiné t'a donné d'autres seuils, mets les siens. L'historique est recalculé aussitôt.</p>
    <div class="thresholds">${thr('t-during', 'Max pendant', p.painMaxDuring)}${thr('t-next', 'Max lendemain', p.painMaxNextDay)}${thr('t-back', 'Recul dès', p.painStepBack)}</div>
  </section>
  <section class="card"><h2>Sauvegarde</h2>
    <p class="note">Tes données sont enregistrées sur ${where === 'cloud' ? 'ton compte Claude (privées)' : 'ce téléphone uniquement'}. Copie l'export de temps en temps pour garder une sauvegarde.</p>
    ${ui.exportOpen ? `<textarea class="code" id="io">${JSON.stringify(state)}</textarea>
      <div class="row"><button class="btn ghost" data-action="copy">Copier</button><button class="btn ghost" data-action="import">Importer le texte collé</button></div>`
      : `<button class="btn ghost" data-action="export">Exporter / importer</button>`}
    ${ui.confirm === 'reset'
      ? `<div class="row"><button class="btn danger" data-action="reset">Tout effacer</button><button class="btn ghost" data-action="cancel">Annuler</button></div>`
      : `<button class="btn ghost" data-action="ask" data-what="reset">Recommencer à zéro</button>`}
  </section>`;
}

/* ---------- 4. ACTIONS ---------- */
let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 2400);
}

async function persist(msg) {
  const ok = await Storage.save(state);
  toast(ok ? msg : 'Enregistré sur ce téléphone, la synchronisation a échoué');
}

const actions = {
  tab: (d) => { ui.tab = d.tab; ui.confirm = null; ui.exportOpen = false; window.scrollTo(0, 0); },

  start: () => {
    const loads = {};
    for (const ex of Engine.DEFAULT_PROGRAM.exercises) loads[ex.id] = Math.max(0, parseFloat(document.getElementById('start-' + ex.id).value.replace(',', '.')) || 0);
    state = Engine.newState(loads); refresh(); persist('Programme lancé');
  },

  step: (d) => {
    const e = draft.entries[d.ex];
    const ex = state.program.exercises.find((x) => x.id === d.ex);
    const inc = d.field === 'load' ? ex.step : 1;
    e[d.field] = Math.max(0, e[d.field] + Number(d.delta) * inc);
  },

  pain: (d) => {
    const v = Number(d.v);
    if (d.target === 'during') draft.painDuring[d.knee] = v; else nextDraft[d.knee] = v;
  },

  'save-session': () => {
    state.sessions.push({
      id: 's' + Date.now(), date: today(), week: pos.week,
      entries: JSON.parse(JSON.stringify(draft.entries)),
      painDuring: { ...draft.painDuring }, painNextDay: null,
    });
    refresh(); window.scrollTo(0, 0);
    persist('Séance enregistrée. Note ta douleur demain matin.');
  },

  'save-next': () => {
    const last = state.sessions[state.sessions.length - 1];
    last.painNextDay = { ...nextDraft };
    nextDraft = { L: null, R: null };
    refresh(); persist('Douleur du lendemain enregistrée');
  },

  ask: (d) => { ui.confirm = d.what; },
  cancel: () => { ui.confirm = null; },
  'delete-last': () => { state.sessions.pop(); ui.confirm = null; refresh(); persist('Séance supprimée'); },
  reset: () => { state = null; ui.confirm = null; ui.tab = 'seance'; Storage.save({}); try { localStorage.clear(); } catch {} toast('Données effacées'); },

  export: () => { ui.exportOpen = true; },
  copy: () => {
    const ta = document.getElementById('io');
    navigator.clipboard?.writeText(ta.value).then(() => toast('Copié'), () => { ta.select(); toast('Sélectionné : copie-le manuellement'); })
      ?? (ta.select(), toast('Sélectionné : copie-le manuellement'));
    return 'no-render';
  },
  import: () => {
    try {
      const data = JSON.parse(document.getElementById('io').value);
      if (!data.program || !Array.isArray(data.sessions)) throw new Error();
      state = data; ui.exportOpen = false; refresh(); persist('Données importées');
    } catch { toast('Texte invalide : colle un export complet'); return 'no-render'; }
  },
};

// Un seul écouteur pour toute la page ("délégation d'événements")
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-action]');
  if (!btn || btn.disabled || btn.tagName === 'INPUT') return;
  const fn = actions[btn.dataset.action];
  if (!fn) return;
  if (fn(btn.dataset) !== 'no-render') render();
});

// Modification des seuils de douleur
document.addEventListener('change', (ev) => {
  if (ev.target.dataset.action !== 'threshold' || !state) return;
  const v = Math.min(10, Math.max(0, Math.round(Number(ev.target.value))));
  const key = { 't-during': 'painMaxDuring', 't-next': 'painMaxNextDay', 't-back': 'painStepBack' }[ev.target.id];
  state.program[key] = v; refresh(); render(); persist('Seuil mis à jour, historique recalculé');
});

// Démarrage
(async function init() {
  render();
  const res = await Storage.load();
  where = res.where;
  state = res.state && res.state.program ? res.state : null;
  if (state) refresh();
  ui.loading = false;
  render();
})();
