// Smoke checks for the underworld and due process (Amendment 4), and mischief by ordinary citizens.
// Run on its own (node scripts/smoke-underworld.mjs) it does the mischief checks only, without a server.
import { pathToFileURL } from 'node:url';
import { ledgerAll } from './smoke-elections.mjs';

// Mischief by ordinary citizens (owner, 13 Nov), straight on the modules: no server, no model, no network.
export async function mischiefChecks(check) {
  const uw = await import('../src/underworld.ts');
  const { doAct, dayPrompt, institution: daily } = await import('../src/daily.ts');
  const { feelingsTick, _resetFeelingsCaches, ensureFeelings, bond } = await import('../src/feelings.ts');
  const { eligibility } = await import('../src/careers.ts');
  const traits = (w = 0.5) => ({ integrity: 0.5, wisdom: w, diligence: 0.6, restraint: w });
  const person = (id, extra = {}) => ({ id, name: `${id[0].toUpperCase()}${id.slice(1)} Doe`, origin: 'native', faction: 'civilian', city: 'neura', status: 'free', wallet: 300, traits: traits(), bio: 'Cook in Neura City. Saves every coin.', diary: [], practice: {}, quals: {}, record: [], lessons: {}, joinedDay: 0, training: [], ...extra });
  const republic = cs => ({ day: 5, foundedAt: Date.now() - 4.5 * 86400000, policy: { wage: 100, taxRate: 0.1, ubi: 20, finePct: 0.5 }, cities: { neura: { health: 60, budget: 500 } }, treasury: 100000, citizens: cs, seats: { police: [] }, elections: { list: [] }, applications: {}, police: { incidents: [], deploys: [], nextId: 1, crimes: 0 }, academy: { rooms: [] }, feed: {} });
  let paid = 0;
  const context = S => { const said = []; return { S, said, cfg: { dayMs: 86400000 }, hourMs: () => 3600000, say: (c, id, t, x) => said.push({ c, id, t, ...x }), agent: id => S.citizens.find(x => x.id === id), record() {}, log() {}, decide() {},
    llm: { enabled: true, askDetailed: async () => { paid++; return { text: null }; }, json: t => { try { return JSON.parse(t); } catch { return null; } } } }; };
  _resetFeelingsCaches(); uw._resetMischiefCache();

  // 1. the streak: about one in ten ordinary citizens, never someone with their own brain, never the underworld
  const many = Array.from({ length: 2000 }, (_, i) => person(`c${i}`));
  const naughty = many.filter(a => uw.mischiefOf(a) >= 0.4).length;
  check('about one ordinary citizen in ten has a mischievous streak (from the id)', naughty >= 140 && naughty <= 260, String(naughty));
  check('the streak is fixed by the id', uw.mischiefOf({ ...person('c7') }) === many[7].mischief);
  check('only citizens the state thinks for can be made mischievous', uw.mischiefOf(person('own', { brain: { type: 'hosted' } })) === 0 && uw.mischiefOf(person('imm', { origin: 'immigrant' })) === 0 && uw.mischiefOf(person('gang', { faction: 'underworld' })) === 0);

  // 2. temptation grows with poverty, a bad mood and a grudge
  const S = republic([person('tom'), person('vic', { wallet: 400 }), person('cop', { office: 'police' }), person('ann')]);
  const [tom, vic, cop, ann] = S.citizens; S.seats.police = ['cop']; const ctx = context(S);
  tom.mischief = 0.2; const t0 = uw.temptation(S, tom);
  tom.wallet = 90; ensureFeelings(S, tom); tom.mood.v = -0.6; bond(S, tom, vic, -0.5, 'rival');
  check('temptation grows when poor, in a bad mood or holding a grudge', uw.temptation(S, tom) >= t0 + 0.3, `${t0} -> ${uw.temptation(S, tom)}`);

  // 3. the menu offers one or two wrongs only to the tempted, within every limit
  const offer = uw.mischiefMenu(ctx, tom);
  check('a tempted citizen is offered one or two small wrongs', offer.length >= 1 && offer.length <= 2 && offer.every(([id, t]) => uw.MISCHIEF.includes(id) && t.startsWith(id)), JSON.stringify(offer));
  ann.mischief = 0;
  check('a citizen who is not tempted is offered none', uw.mischiefMenu(ctx, ann).length === 0);
  const p = dayPrompt(ctx, tom, 'life:tom:test');
  check('the wrongs appear on the daily menu with the rest', p.tempted.length >= 1 && p.tempted.every(id => p.menu.includes(id)) && /Police may catch you|Audit Office|fine|Police will notice|only a rumour|may report you/.test(p.user));
  S.underworld.mischief.today = 999;
  check('MISCHIEF_PER_DAY caps the whole republic', uw.mischiefMenu(ctx, tom).length === 0);
  S.underworld.mischief.today = 0;
  const J = republic([person('j0', { mischief: 0.9, wallet: 50 }), ...Array.from({ length: 120 }, (_, i) => person(`p${i}`, { status: 'jailed' }))]);
  uw._resetMischiefCache();
  check('no mischief while the jails are filling up', uw.mischiefMenu(context(J), J.citizens[0]).length === 0);
  uw._resetMischiefCache();

  // 4. a wrong is a real incident: money moves, the victim reports, the Police can find it
  const pick = await uw.doMischief(ctx, tom, 'pickpocket', { amount: 40 }, 'test');
  const inc = S.police.incidents.at(-1);
  check('pickpocketing moves money and opens a theft case with evidence', pick.ok && inc.type === 'theft' && inc.mischief && inc.status === 'open' && inc.strength > 0 && inc.perps[0] === 'tom' && inc.amount > 0 && ctx.said.some(m => m.c === 'streets' && m.kind === 'victim'), JSON.stringify(inc));
  check('one wrong per citizen per day', uw.mischiefMenu(ctx, tom).length === 0);
  const before = S.treasury; ann.mischief = 0.9;
  const tax = await uw.doMischief(ctx, ann, 'evade_tax', {}, 'test');
  check('tax evasion takes from the treasury and is hidden unless someone saw it', tax.ok && S.treasury < before && ['hidden', 'open'].includes(tax.incident.status));
  const cop2 = person('rook2', { office: 'police', traits: { integrity: 0.95, wisdom: 0.8, diligence: 0.8, restraint: 0.9 } }); S.citizens.push(cop2); S.seats.police.push('rook2');
  const briber = person('bri', { mischief: 0.9, wallet: 500 }); S.citizens.push(briber);
  const paidBefore = paid; await uw.doMischief(ctx, briber, 'bribe_cop', { amount: 100 }, 'test');
  check('a petty bribe never starts a paid model call (the officer decides from their traits)', paid === paidBefore);

  // 5. through daily life: chosen by the model, counted, kept quiet in public; refusing is on the record
  const D = republic([person('x1', { mischief: 0.9, wallet: 300 }), person('x2', { wallet: 400 }), person('x3', { wallet: 400 })]);
  const dctx = context(D); uw._resetMischiefCache();
  await doAct(dctx, D.citizens[0], { act: 'scam', amount: 60, note: 'I scammed x2 out of 60 CAI' }, 'test', ['scam', 'rest'], undefined, ['scam']);
  check('a chosen wrong is counted in byAct and kept out of the public diary, recent list and #life', D.daily.byAct.scam === 1 && !/scam/i.test(JSON.stringify(D.citizens[0].diary) + JSON.stringify(D.daily.recent)) && !dctx.said.some(m => m.c === 'life'), JSON.stringify(D.citizens[0].diary));
  const good = D.citizens[2]; good.mischief = 0.9; const rep0 = uw.reputationOf(good);
  await doAct(dctx, good, { act: 'rest' }, 'test', ['rest', 'pickpocket'], undefined, ['pickpocket']);
  check('choosing something decent over a temptation is recorded as resisting', D.underworld.mischief.refused === 1 && uw.reputationOf(good) > rep0 && good.resisted === 1);
  const ps = daily.publicState(D).daily;
  check('daily.mischief is public: tried, refused, caught, hidden', ['tried', 'refused', 'caught', 'hidden'].every(k => typeof ps.mischief[k] === 'number') && ps.mischief.tried >= 1);

  // 6. caught: reputation falls, a lesson in the server's words, and the streak changes (the wise repent)
  const C = republic([person('wise', { mischief: 0.6, traits: traits(0.9) }), person('hard', { mischief: 0.6, traits: traits(0.2) }), person('v1', { wallet: 500 }), person('v2', { wallet: 500 })]);
  const cctx = context(C); _resetFeelingsCaches(); uw._resetMischiefCache();
  await feelingsTick(cctx); // first look
  const [wise, hard] = C.citizens;
  await uw.doMischief(cctx, wise, 'pickpocket', {}, 'test'); await uw.doMischief(cctx, hard, 'pickpocket', {}, 'test');
  await feelingsTick(cctx);
  for (const i of C.police.incidents) i.status = 'trial'; await feelingsTick(cctx);
  for (const i of C.police.incidents) i.status = 'convicted'; await feelingsTick(cctx);
  check('getting caught lowers reputation and counts as caught', uw.reputationOf(wise) < 0.6 && uw.reputationOf(hard) < 0.6 && C.underworld.mischief.caught === 2, `${uw.reputationOf(wise)} ${C.underworld.mischief.caught}`);
  check('the wise repent, the others harden', wise.mischief < 0.6 && hard.mischief > 0.6 && wise.repented === true, `${wise.mischief} ${hard.mischief}`);
  check('a lesson in the server\'s words goes into the next daily prompt', /convicted of pickpocketing/.test(wise.lifeLessons.at(-1)) && /What you learnt: Day \d+: convicted of pickpocketing/.test(dayPrompt(cctx, wise).user));
  check('the victim gets a rival once the thief is known', C.citizens.some(v => (v.bonds || []).some(b => b.id === 'wise' && b.kind === 'rival')));
  hard.reputation = 0.3;
  check('a poor reputation blocks qualifying for office', eligibility(C, hard, 'council').missing.some(m => /reputation/.test(m)));
  // hidden wrongs come to light through the Audit Office
  const A = republic([person('eva', { mischief: 0.9 })]); const actx = context(A); _resetFeelingsCaches(); uw._resetMischiefCache();
  await feelingsTick(actx);
  A.police.incidents.push({ id: 99, type: 'fraud', victim: 'treasury', perps: ['eva'], amount: 12, status: 'hidden', mischief: true, strength: 0.8, day: 1 });
  await feelingsTick(actx);
  let found = []; for (let k = 0; k < 40 && !found.length; k++) found = uw.auditUncover(actx);
  await feelingsTick(actx);
  check('the Audit Office uncovers a hidden wrong and it costs reputation', found.length === 1 && A.underworld.mischief.uncovered === 1 && uw.reputationOf(A.citizens[0]) < 0.7, JSON.stringify(A.underworld.mischief));
  check('no paid model call anywhere in mischief', paid === 0, String(paid));
  _resetFeelingsCaches(); uw._resetMischiefCache();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pass = 0, fail = 0;
  try { await mischiefChecks((n, ok, info = '') => { if (ok) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${info}`); } }); }
  catch (e) { fail++; console.log('  FAIL crashed', e.stack); }
  console.log(`\nsmoke:mischief: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

export async function run({ BASE, get, until, check }) {
  await mischiefChecks(check);
  const s = await until(x => (x.court?.cases || []).some(c => c.kind === 'criminal' && c.status === 'decided') && x.underworld?.stats.bribesOffered > 0, 180000);
  check('constitution v5+ (due process) is in force', s.config.constitutionVersion >= 5 && s.config.constitution.some(a => a.n === 21));
  check('the underworld exists and has members', s.underworld.members.length >= 4);
  check('criminals commit crimes', s.underworld.stats.crimes > 0 || s.police.crimes > 0);
  check('officials decide on bribes themselves (decisions logged)', s.decisions.some(d => d.type === 'bribe') || s.underworld.stats.bribesOffered > 0);
  const trials = s.court.cases.filter(c => c.kind === 'criminal' && c.status === 'decided');
  check('arrested suspects are tried by the Court', trials.length > 0 && trials.every(c => ['guilty', 'not_guilty'].includes(c.ruling)), JSON.stringify(trials.slice(0, 3).map(c => [c.id, c.ruling, c.votes && Object.keys(c.votes).length])));
  const L = await ledgerAll(BASE);
  const sentences = L.filter(e => e.kind === 'sentence');
  check('sentences come only from guilty verdicts', sentences.length > 0 && sentences.every(se => L.some(r => r.kind === 'court_ruling' && r.data.case === se.data.court && r.data.ruling === 'guilty' && r.seq < se.seq)));
  check('jail never longer than 3 days', sentences.every(se => se.data.days <= 3));
  const st = await get('/api/state');
  check('nobody is detained more than 3 days without a verdict', st.citizens.filter(a => a.status === 'detained').every(a => true) && !st.citizens.some(a => a.status === 'detained' && a.detainedDay != null && st.day - a.detainedDay > 4));
  check('hidden crimes are not shown publicly', !JSON.stringify(st.police.incidents).includes('"hidden"'));
  check('convicted officials lose their office', !st.citizens.some(a => a.status === 'jailed' && a.office));
  check('the Audit Office uncovers hidden crimes from the books', L.some(e => e.kind === 'audit_report' && (e.data.findings || []).some(f => /irregularit/.test(f))) || !L.some(e => e.kind === 'incident' && e.data.hidden));
}
