/* =====================================================================
 * engine.js — le "cerveau" de l'application
 * ---------------------------------------------------------------------
 * Ce fichier ne touche JAMAIS à l'écran ni au stockage.
 * Il reçoit des données (le programme + l'historique des séances)
 * et renvoie des décisions (où j'en suis, quelle charge, quel conseil).
 * Avantage : on peut le tester tout seul avec Node, sans navigateur.
 * ===================================================================== */
const Engine = (() => {

  /* ---------- 1. Le programme par défaut (protocole HSR) ----------
   * Heavy Slow Resistance : 3 séances / semaine, mouvement lent
   * (3 s en descente, 3 s en montée). Les répétitions baissent
   * pendant que la charge monte. Chaque ligne = une semaine. */
  const DEFAULT_PROGRAM = {
    name: 'HSR 12 semaines',
    sessionsPerWeek: 3,
    painMaxDuring: 5,   // douleur pendant la séance acceptable jusqu'à 5/10
    painMaxNextDay: 3,  // le lendemain matin, au-dessus de 3/10 on ne progresse pas
    painStepBack: 6,    // à partir de 6/10 (pendant ou lendemain) on recule
    exercises: [
      { id: 'hack',  name: 'Hack squat',       step: 2.5 },
      { id: 'squat', name: 'Squat à la barre', step: 2.5 },
      { id: 'press', name: 'Presse à cuisses', step: 5 },
    ],
    weeks: [
      { sets: 3, reps: 15 },
      { sets: 3, reps: 12 }, { sets: 3, reps: 12 },
      { sets: 4, reps: 10 }, { sets: 4, reps: 10 },
      { sets: 4, reps: 8 },  { sets: 4, reps: 8 },  { sets: 4, reps: 8 },
      { sets: 4, reps: 6 },  { sets: 4, reps: 6 },  { sets: 4, reps: 6 }, { sets: 4, reps: 6 },
    ],
  };

  /* ---------- 2. Petites fonctions utilitaires ---------- */

  // Arrondit une charge au disque le plus proche (ex. pas de 2,5 kg)
  const roundTo = (x, step) => Math.round(x / step) * step;

  // Formule d'Epley : estime le 1RM (charge max sur 1 rép.)
  // à partir d'une série de plusieurs répétitions.
  const e1rm = (load, reps) => (reps <= 1 ? load : load * (1 + reps / 30));

  // Inverse d'Epley : quelle charge pour faire `reps` répétitions ?
  const loadFor = (oneRm, reps) => oneRm / (1 + reps / 30);

  const maxPain = (p) => (p ? Math.max(p.L ?? 0, p.R ?? 0) : null);

  /* ---------- 3. Verdict d'UNE séance (feu tricolore) ----------
   * green  : douleur dans les clous -> on peut monter
   * orange : supportable mais limite -> on garde la charge
   * red    : trop douloureux -> on recule
   * Le lendemain matin compte autant que pendant la séance :
   * c'est le principe du "pain monitoring model". */
  function sessionVerdict(session, program) {
    const during = maxPain(session.painDuring);
    const next = maxPain(session.painNextDay);   // null si pas encore saisi
    if (during >= program.painStepBack || (next !== null && next >= program.painStepBack)) return 'red';
    if (during > program.painMaxDuring || (next !== null && next > program.painMaxNextDay)) return 'orange';
    return 'green';
  }

  // Toutes les séries et répétitions prévues ont-elles été faites ?
  const completed = (entry, week) => entry.setsDone >= week.sets && entry.repsDone >= week.reps;

  /* ---------- 4. Le rejeu de l'historique ----------
   * On ne stocke PAS "je suis en semaine 3". On stocke seulement
   * la liste des séances, et on recalcule la position en rejouant
   * l'historique depuis le début. Si on corrige une vieille séance,
   * tout se recalcule tout seul. (Technique appelée "event sourcing".) */
  function replay(state) {
    const prog = state.program;
    const pos = {
      week: 0,                       // index de la semaine du programme (0 = semaine 1)
      sessionInWeek: 0,              // nb de séances déjà faites dans ce bloc
      blockRepeats: 0,               // nb de fois que ce bloc a été prolongé
      loads: { ...state.startLoads },// charge prévue pour la PROCHAINE séance
      lastE1rm: {},                  // dernier 1RM estimé par exercice
      history: [],                   // décisions prises, pour l'affichage
      finished: false,
    };
    let block = [];                  // séances du bloc (semaine) en cours

    for (const s of state.sessions) {
      const week = prog.weeks[pos.week];
      const verdict = sessionVerdict(s, prog);
      const allDone = prog.exercises.every((ex) => s.entries[ex.id] && completed(s.entries[ex.id], week));

      // a) charge de la séance suivante, exercice par exercice
      for (const ex of prog.exercises) {
        const e = s.entries[ex.id];
        if (!e) continue;
        pos.lastE1rm[ex.id] = e1rm(e.load, e.repsDone);
        if (verdict === 'green' && completed(e, week)) pos.loads[ex.id] = e.load + ex.step;
        else if (verdict === 'red') pos.loads[ex.id] = Math.max(0, roundTo(e.load * 0.9, ex.step));
        else pos.loads[ex.id] = e.load;
      }
      block.push({ verdict, allDone });
      pos.history.push({ id: s.id, date: s.date, week: pos.week, verdict, allDone });
      pos.sessionInWeek++;

      // b) fin de semaine : avancer, prolonger ou reculer ?
      if (pos.sessionInWeek >= prog.sessionsPerWeek) {
        const anyRed = block.some((b) => b.verdict === 'red');
        const allGood = block.every((b) => b.verdict === 'green' && b.allDone);
        let decision;
        if (anyRed && pos.week > 0) decision = 'back';
        else if (allGood) decision = 'advance';
        else decision = 'repeat';

        const oldWeek = pos.week;
        if (decision === 'advance') pos.week++;
        if (decision === 'back') pos.week--;
        pos.blockRepeats = decision === 'repeat' ? pos.blockRepeats + 1 : 0;
        pos.history[pos.history.length - 1].weekDecision = decision;

        if (pos.week >= prog.weeks.length) { pos.finished = true; pos.week = prog.weeks.length - 1; }
        else if (pos.week !== oldWeek) {
          // Nouveau nombre de reps -> nouvelle charge calculée via le 1RM estimé
          const reps = prog.weeks[pos.week].reps;
          for (const ex of prog.exercises) {
            const rm = pos.lastE1rm[ex.id];
            if (!rm) continue;
            let next = roundTo(loadFor(rm, reps), ex.step);
            if (decision === 'advance') next = Math.max(next, s.entries[ex.id]?.load ?? 0);
            if (decision === 'back') next = Math.min(next, pos.loads[ex.id]);
            pos.loads[ex.id] = next;
          }
        }
        pos.sessionInWeek = 0;
        block = [];
      }
    }
    return pos;
  }

  /* ---------- 5. Le conseil affiché en haut de l'écran ---------- */
  function advice(state, pos) {
    const prog = state.program;
    const last = pos.history[pos.history.length - 1];
    if (pos.finished) return { tone: 'green', title: 'Programme terminé', text: 'Les 12 semaines sont validées. Fais le point avec ton kiné pour la suite.' };
    if (!last) return { tone: 'neutral', title: 'Première séance', text: 'Charges modérées, mouvement lent (3 s en bas, 3 s en haut). Note ta douleur à la fin.' };

    const wk = `semaine ${pos.week + 1}`;
    if (last.weekDecision === 'advance') return { tone: 'green', title: `Tu passes en ${wk}`, text: `Moins de répétitions, charge recalculée à partir de ton 1RM estimé.` };
    if (last.weekDecision === 'back') return { tone: 'red', title: `Retour en ${wk}`, text: 'Une séance de la semaine a été trop douloureuse. On reprend un cran plus bas.' };
    if (last.weekDecision === 'repeat') return { tone: 'orange', title: `On prolonge la ${wk}`, text: 'Douleur limite ou séries pas toutes terminées. Mêmes répétitions, une semaine de plus.' };

    if (last.verdict === 'red') return { tone: 'red', title: 'Charge baissée de 10 %', text: 'La dernière séance a dépassé le seuil de douleur. Si ça se répète, parles-en à ton kiné.' };
    if (last.verdict === 'orange') return { tone: 'orange', title: 'Même charge', text: 'Douleur un peu haute la dernière fois. On consolide avant de monter.' };
    return { tone: 'green', title: 'Charge augmentée', text: `Dernière séance validée : ${prog.exercises.map((e) => `+${String(e.step).replace('.', ',')} kg ${e.name.toLowerCase()}`).join(', ')}.` };
  }

  /* ---------- 6. La séance du jour, pré-remplie ---------- */
  function todaySession(state, pos) {
    const week = state.program.weeks[pos.week];
    return {
      week: pos.week,
      sessionInWeek: pos.sessionInWeek,
      sets: week.sets,
      reps: week.reps,
      entries: Object.fromEntries(state.program.exercises.map((ex) => [ex.id, {
        load: pos.loads[ex.id] ?? 0, setsDone: week.sets, repsDone: week.reps,
      }])),
    };
  }

  // La dernière séance attend-elle sa douleur du lendemain ?
  function pendingNextDay(state, today) {
    const last = state.sessions[state.sessions.length - 1];
    if (!last || last.painNextDay) return null;
    return last.date < today ? last : null;
  }

  function newState(startLoads) {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      program: JSON.parse(JSON.stringify(DEFAULT_PROGRAM)),
      startLoads,
      sessions: [],
    };
  }

  return { DEFAULT_PROGRAM, roundTo, e1rm, loadFor, sessionVerdict, replay, advice, todaySession, pendingNextDay, newState };
})();

// Permet à Node (les tests) de charger ce fichier ; ignoré dans le navigateur
if (typeof module !== 'undefined') module.exports = Engine;
