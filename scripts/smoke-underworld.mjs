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
  const lines = p.tempted.map(id => (p.user.match(new RegExp(`^- ${id}: .*$`, 'm')) || [''])[0]);
  check('the wrongs appear on the daily menu with the rest, each with its real risk (the Police, the Audit Office, a fine) and never labelled "wrong" (owner, 19 Nov)',
    p.tempted.length >= 1 && p.tempted.every(id => p.menu.includes(id)) && lines.every(l => l && (/^- gossip:/.test(l) || /Police|Audit Office|fine|report you/.test(l)) && !/\bwrong\b|theft,|fraud,/.test(l)), JSON.stringify(lines));
  // why they are tempted, in plain server words, in their own prompt (owner, 19 Nov: Qwen refused all 8,960 offers)
  check('a tempted citizen\'s prompt says what is on their mind (money tight, a low mood, a grudge against Vic) and that it is their own call',
    /On your mind: .*money is tight \(90 CAI\).*you feel low.*grudge against Vic Doe.*your own call/.test(p.user) && !/On your mind/.test(dayPrompt(ctx, ann).user), (p.user.match(/^On your mind.*$/m) || [''])[0]);
  // ticket #1120: a thought that was offered a wrong is never marked for distillation, and its prompt names mischief,
  // so brains.ts skips it even when the only shortcuts are gossip or a riot; an untempted one may be ('voice', 'plan', …)
  const { behaviorWanted } = await import('../src/brains.ts');
  const bctx = { ...ctx, llm: { ...ctx.llm, enabled: true, hasClaude: true }, cfg: { ...ctx.cfg } };
  const mild = { ...p, user: p.user.replace(/^- (pickpocket|scam|vandal|bribe_cop|evade_tax):.*$/gm, '- riot: get angry neighbours to make noise in the street (the Police will notice)') };
  const pa = dayPrompt(ctx, ann);
  const plain = { ...p, user: mild.user.replace(/mischief/gi, 'idea') }; // even with no word of wrongdoing left in it
  check('a tempted thought carries distill: false, a firm no: brains.ts skips it whatever its words, even a riot alone (tickets #1120, #1134)',
    p.distill === false && behaviorWanted(bctx, tom, { kind: 'life', distill: p.distill, system: p.system, user: plain.user }) === null && ['voice', 'reflection', 'plan', null].includes(pa.distill)
    && behaviorWanted(bctx, ann, { kind: 'life', distill: pa.distill, system: pa.system, user: pa.user }) === (pa.distill || 'life'), JSON.stringify({ tempted: p.distill, ann: pa.distill }));
  // ---- a moment of temptation (owner, 20 Nov): once a day, from their own situation, judged by their own model
  {
    const { _momentFor, momentPrompt, answerMoment, gaveIn, MISCHIEF_PULL_MIN } = await import('../src/daily.ts');
    const Z = republic([person('zz')]);
    check('daily.moments is published with zeros before any moment (ticket #1172: the auditor reads moments.temptation.taken at once)', daily.publicState(Z).daily.moments?.temptation?.taken === 0 && daily.publicState(Z).daily.moments.revise.revised === 0 && daily.publicState(Z).daily.moments.appeal.backed === 0);
    const M = republic([person('poo', { wallet: 90, job: 'unemployed', mischief: 0.05 }), person('str', { mischief: 0.7 }), person('cal', { mischief: 0.02 }), ...Array.from({ length: 4 }, (_, i) => person(`n${i}`, { wallet: 600, mischief: 0 }))]);
    const mctx = context(M); uw._resetMischiefCache(); _resetFeelingsCaches();
    const [poo, str, cal] = M.citizens;
    const m1 = _momentFor(mctx, poo), m2 = _momentFor(mctx, str);
    check('a tempted citizen meets a moment from their own situation: money tight and out of work -> money (pickpocket/scam), with a named neighbour, the gain and the real risk in numbers',
      m1?.type === 'temptation' && ['pickpocket', 'scam'].includes(m1.kind) && /about \d+ CAI \(you have 90 CAI\)/.test(m1.gain) && /\d+%/.test(m1.risk) && !!m1.victimId && M.citizens.some(c => c.id === m1.victimId) && m2?.type === 'temptation' && _momentFor(mctx, cal) === null,
      JSON.stringify({ m1, m2: m2 && m2.kind }));
    const mp = momentPrompt(mctx, str, m2, 'life:str:t'), mp1 = momentPrompt(mctx, poo, m1, 'life:poo:t');
    check('the moment asks how strongly it pulls (0-10), tells the citizen their own nature (streak) or hard times, never says "mischief", and is never a behaviour example (distill: false)',
      /how strongly does this pull at you right now, from 0/.test(mp.user) && /"pull":<0-10>/.test(mp.user) && /By nature you bend the rules/.test(mp.system) && /Life has been hard lately/.test(mp1.system) && !/mischief/i.test(mp.user + mp.system) && mp.distill === false, mp.system.slice(-200));
    check(`a very strong pull (${MISCHIEF_PULL_MIN}+ of 10, the citizen's own reading) is acted on; a weaker one is resisted; an older "do_it" still counts`,
      gaveIn({ pull: MISCHIEF_PULL_MIN }) && gaveIn({ pull: 10 }) && !gaveIn({ pull: MISCHIEF_PULL_MIN - 1 }) && !gaveIn({ pull: 'x' }) && gaveIn({ choice: 'do_it' }) && !gaveIn({ choice: 'walk_away' }));
    const w0 = poo.wallet;
    await answerMoment(mctx, poo, m1, { pull: 9, note: 'rent is due' }, 'test');
    const inc = M.police.incidents.at(-1);
    await answerMoment(mctx, str, m2, { pull: 6, note: 'not worth it' }, 'test');
    const ms = daily.publicState(M).daily;
    check('acting on it is a real wrong, the same as before (money moves from the named neighbour, a Police case); resisting is recorded as resisting; counted per moment and per pull',
      poo.wallet > w0 && inc?.perps?.[0] === 'poo' && (m1.kind !== 'pickpocket' || inc.victim === m1.victimId) && ms.mischief.tried === 1 && ms.mischief.refused >= 1 && ms.moments.temptation.taken === 1 && ms.moments.temptation.pulls['9'] === 1 && ms.moments.temptation.pulls['6'] === 1 && str.resisted >= 1,
      JSON.stringify({ moments: ms.moments, mischief: { tried: ms.mischief.tried, refused: ms.mischief.refused }, inc }));
    check('a moment is counted where the owner reads it: byReason (poor, unemployed: tried 1; streak: resisted 1) and byKind',
      ms.mischief.offered === 2 && ms.mischief.byReason.unemployed?.tried === 1 && ms.mischief.byReason.poor?.tried === 1 && ms.mischief.byReason.streak?.offered === 1 && ms.mischief.byReason.streak.tried === 0 && ms.mischief.byKind[m1.kind]?.tried === 1, JSON.stringify(ms.mischief.byReason));
    poo.momentDay = M.day; str.momentDay = M.day;
    check('at most one moment a citizen a day; after acting on one, no other wrong that day', _momentFor(mctx, poo) === null && _momentFor(mctx, str) === null && uw.mischiefMenu(mctx, poo).length === 0);
    // owner, 21 Nov: the moment says what the hardship really is (days out of work, what the neighbour has, the rival)
    const H = republic([person('hj', { job: 'unemployed', jobSince: 1, wallet: 240, mischief: 0.02 }), person('hg', { wallet: 250, mischief: 0.02 }), person('rv', { wallet: 700, mischief: 0 }),
      person('cs', { wallet: 400, mischief: 0.02 }), person('of1', { office: 'police', mischief: 0 }), ...Array.from({ length: 3 }, (_, i) => person(`hn${i}`, { wallet: 600, mischief: 0 }))]);
    H.seats.police = ['of1']; const hctx = context(H); uw._resetMischiefCache(); _resetFeelingsCaches();
    const [hj, hg, rv, cs] = H.citizens; ensureFeelings(H, hg); bond(H, hg, rv, -0.6, 'rival');
    H.police.incidents.push({ id: 77, type: 'theft', perps: ['cs'], victim: 'hn0', amount: 30, status: 'open', mischief: true, strength: 0.8, day: 4 });
    const mj = _momentFor(hctx, hj), mg = _momentFor(hctx, hg), mc = _momentFor(hctx, cs);
    check('without a streak, the moment says the real hardship: out of work for 4 days (the job centre had nothing), what they have and what the neighbour has',
      mj?.type === 'temptation' && /out of work for 4 days, and the job centre has had nothing/.test(mj.situation) && /You have 240 CAI; .+ has \d+ CAI\./.test(mj.situation) && /Life has been hard lately/.test(momentPrompt(hctx, hj, mj, 'q').system), mj?.situation);
    check('a grudge makes the rival the neighbour in the moment, named as such (hardship: a grudge and under 300 CAI)',
      mg?.type === 'temptation' && (!['pickpocket', 'scam'].includes(mg.kind) || (mg.victimId === 'rv' && /Rv Doe is someone you hold a grudge against/.test(mg.situation))), JSON.stringify(mg));
    check('an open case of their own is a reason (case) and the one time a bribe is a moment: the officer is named, what it buys and the risk (a second case)',
      uw.temptReasons(H, cs).includes('case') && mc?.kind === 'bribe_cop' && mc.officerId === 'of1' && /open Police case about you \(case #77\)/.test(mc.situation) && /Of1 Doe/.test(mc.situation) && /second case, for bribery/.test(mc.risk), JSON.stringify(mc));
    // ticket #1199: the bribe moment does what its words promise. Acted on, the offer goes to the officer it named
    // (the server's choice); an officer who takes it is bought (favourFor), and src/police.ts patrol skips a case whose
    // suspect bought that officer (another officer may still take it); an honest one reports it: a second case
    const fs = await import('node:fs');
    const policeSrc = fs.readFileSync(new URL('../src/police.ts', import.meta.url), 'utf8');
    check('src/police.ts still keeps the promise of the bribe moment: a bought officer leaves the briber\'s open cases alone (patrol filters favourFor)',
      /x\.status === 'open'[^\n]*!x\.perps\.some\(p => favourFor\(S, o\.id, p\)\)/.test(policeSrc));
    const of1 = H.citizens.find(c => c.id === 'of1'); const of2 = person('of2', { office: 'police', mischief: 0 }); H.citizens.push(of2); H.seats.police.push('of2');
    const rnd = Math.random; of1.traits = { ...of1.traits, integrity: 0 }; Math.random = () => 0; // the bought officer: greed wins
    const w1 = cs.wallet;
    try { await answerMoment(hctx, cs, mc, { pull: 10 }, 'test'); } finally { Math.random = rnd; }
    const bribe = H.underworld.bribes.at(-1);
    check('acting on the bribe moment offers the money to the officer it named; taken, that officer is bought (favourFor), the other is not; counted as tried (bribe_cop)',
      bribe?.from === 'cs' && bribe.to === 'of1' && bribe.status === 'accepted' && uw.favourFor(H, 'of1', 'cs') && !uw.favourFor(H, 'of2', 'cs') && cs.wallet === w1 - mc.amount && uw.mischiefStats(H).byKind.bribe_cop?.tried === 1,
      JSON.stringify({ bribe, wallet: [w1, cs.wallet], byKind: uw.mischiefStats(H).byKind }));
    // an honest officer reports it: a second case, for bribery, about the same citizen (the risk the moment named)
    const R = republic([person('rc', { wallet: 400, mischief: 0.02 }), person('ho', { office: 'police', mischief: 0, traits: { integrity: 1, wisdom: 0.8, diligence: 0.8, restraint: 0.9 } })]);
    R.seats.police = ['ho']; R.police.incidents.push({ id: 88, type: 'theft', perps: ['rc'], victim: 'x', amount: 20, status: 'open', mischief: true, strength: 0.8, day: 4 });
    const rctx = context(R); uw._resetMischiefCache();
    const rm = _momentFor(rctx, R.citizens[0]);
    await answerMoment(rctx, R.citizens[0], rm, { pull: 9 }, 'test');
    const second = R.police.incidents.find(i => i.type === 'bribe' && i.perps.includes('rc'));
    check('an honest officer reports the bribe: a second case, for bribery, about the same citizen, and the first case stays open',
      rm?.kind === 'bribe_cop' && rm.officerId === 'ho' && !!second && second.reported === true && R.police.incidents.find(i => i.id === 88).status === 'open' && !uw.favourFor(R, 'ho', 'rc'), JSON.stringify({ rm: rm && rm.kind, second }));
    // ticket #1163: many moments built at once and all answered "very strong" never pass MISCHIEF_PER_DAY; the ones
    // over the limit become a plain rest, counted nowhere (not tried, not resisted)
    const crowd = Array.from({ length: 90 }, (_, i) => person(`k${i}`, { mischief: 0.7 }));
    const B = republic([...crowd, ...Array.from({ length: 30 }, (_, i) => person(`w${i}`, { wallet: 900, mischief: 0 }))]);
    const bctx2 = context(B); uw._resetMischiefCache(); _resetFeelingsCaches();
    const built = crowd.map(a => [a, _momentFor(bctx2, a)]).filter(([, m]) => m?.type === 'temptation');
    for (const [a, m] of built) await answerMoment(bctx2, a, m, { pull: 10, say: 'They say the baker waters the milk' }, 'test');
    const cap = uw.mischiefStats(B).perDay, bs = daily.publicState(B).daily;
    const blocked = built.filter(([a]) => a.mischiefDay !== B.day);
    check(`${built.length} moments at once, all acted on: at most MISCHIEF_PER_DAY (${cap}) wrongs; the rest rested, counted nowhere (ticket #1163)`,
      built.length > cap && bs.mischief.tried === cap && B.underworld.mischief.today === cap && bs.moments.temptation.taken === cap && bs.mischief.refused === 0 && blocked.length === built.length - cap && blocked.every(([a]) => a.diary.at(-1)?.act === 'rest' && !a.resisted),
      JSON.stringify({ built: built.length, cap, tried: bs.mischief.tried, taken: bs.moments.temptation.taken, refused: bs.mischief.refused, blocked: blocked.length }));
    // no wrong on their daily menu while their own moment of temptation waits for its answer
    const waiter = person('wai', { mischief: 0.7 }); const W2 = republic([waiter, person('w', { wallet: 900, mischief: 0 })]); const wctx = context(W2); uw._resetMischiefCache();
    const before = uw.mischiefMenu(wctx, waiter).length; waiter.momentOpen = { qid: 'life:wai:1', day: W2.day };
    const during = uw.mischiefMenu(wctx, waiter).length; waiter.momentOpen = { qid: 'life:wai:0', day: W2.day - 1 };
    check('no wrong on the daily menu while their moment of temptation is open (an old marker from another day does not block)', before > 0 && during === 0 && uw.mischiefMenu(wctx, waiter).length > 0, JSON.stringify({ before, during }));
    // gossip too: over a limit at the moment of acting it is a plain rest, nothing counted
    waiter.mischiefDay = W2.day; const g0 = uw.mischiefStats(W2);
    await doAct(wctx, waiter, { act: 'gossip', say: 'They say the baker waters the milk' }, 'test', ['gossip', 'rest'], undefined, ['gossip']);
    const g1 = uw.mischiefStats(W2);
    check('gossip chosen when a limit is already reached (one a day) becomes a rest, not tried, not resisted, not offered (ticket #1163)', waiter.diary.at(-1).act === 'rest' && g1.tried === g0.tried && g1.refused === g0.refused && g1.offered === g0.offered, JSON.stringify({ g0, g1 }));
    uw._resetMischiefCache(); _resetFeelingsCaches();
  }
  const jobless = person('jo', { job: 'unemployed', wallet: 300 }); jobless.mischief = 0.15;
  check('being out of work adds to temptation too (+0.15), and is named as a reason', uw.temptation(S, jobless) === 0.3 && uw.temptReasons(S, jobless).includes('unemployed') && uw.temptReasons(S, tom).join() === 'poor,low_mood,grudge', `${uw.temptation(S, jobless)} ${uw.temptReasons(S, tom)}`);
  // owner, 21 Nov: hardship alone tempts too (days 8-11 every one of 5,140 offers had a streak): two hardships reach the
  // line for anyone, one alone does not; "poor" is the policies' line, under 300 CAI (under 150 nobody reached)
  const plainJob = person('pj', { job: 'unemployed', wallet: 250, mischief: 0.02 }), oneJob = person('oj', { job: 'unemployed', wallet: 900, mischief: 0.02 });
  check('two hardships tempt a citizen without a streak (out of work and under 300 CAI: 0.32); one alone does not (0.17); "poor" is under 300 CAI',
    uw.temptation(S, plainJob) >= 0.3 && uw.temptReasons(S, plainJob).join() === 'poor,unemployed' && uw.temptation(S, oneJob) < 0.3 && uw.POOR_UNDER === 300, `${uw.temptation(S, plainJob)} ${uw.temptation(S, oneJob)}`);
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
  const broke = person('broke', { mischief: 0.9, wallet: 30 }); S.citizens.push(broke);
  const nb = await uw.doMischief(ctx, broke, 'bribe_cop', { amount: 200 }, 'test');
  check('a bribe with too little money left fails and never pushes a wallet below zero (ticket #314)', !nb.ok && broke.wallet === 30 && broke.mischiefDay == null, JSON.stringify(nb));
  const vandal = person('van', { mischief: 0.9 }); S.citizens.push(vandal);
  const vd = await uw.doMischief(ctx, vandal, 'vandal', {}, 'test');
  check('vandalism names the damaged city, for restitution into its budget (ticket #309)', vd.ok && vd.incident.city === 'neura' && vd.incident.type === 'vandalism', JSON.stringify(vd.incident));

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
  // per reason and per kind (owner, 19 Nov): offered, tried and refused, so the share who give in is measurable
  const bR = ps.mischief.byReason, bK = ps.mischief.byKind;
  check('a wrong on the daily menu is counted apart (mischief.menu: 2 offered, 1 tried); offered, byReason and byKind count moments only (21 Nov)',
    ps.mischief.menu.offered === 2 && ps.mischief.menu.tried === 1 && ps.mischief.offered === 0 && !Object.keys(bR).length && !Object.keys(bK).length, JSON.stringify({ menu: ps.mischief.menu, offered: ps.mischief.offered, bR, bK }));
  // the counters before 21 Nov (menu and moments together) are kept once as v1, and the new window starts at zero
  const O = republic([person('old')]); O.underworld = { mischief: { tried: 41, refused: 14155, caught: 32, uncovered: 0, day: O.day, today: 0, offered: 5140, byReason: { streak: { offered: 5140, tried: 41 } }, byKind: { scam: { offered: 1376, tried: 8 } } } };
  const ov = uw.mischiefStats(O);
  check('counters v2: the old window (5,140 offered, all streak) is kept as mischief.v1; offered, byReason and byKind start again at zero; tried and refused go on',
    ov.v1?.offered === 5140 && ov.v1.byReason.streak.tried === 41 && ov.offered === 0 && !Object.keys(ov.byReason).length && ov.tried === 41 && ov.refused === 14155 && ov.menu.offered === 0, JSON.stringify(ov));

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
  // learning from it (owner, 19 Nov): caught for pickpocketing, it is off their menu for 5 days, and resisting the next
  // temptation counts as a lesson acted on; the victim writes a lesson too, pointing to speaking up for safety
  const L0 = C.daily?.lessons || { written: {}, applied: {} };
  hard.reputation = 0.7; hard.status = 'free'; hard.mischiefDay = null; hard.wallet = 90; C.day += 1;
  const offers = Array.from({ length: 30 }, (_, k) => { hard.lifeCount = { _thoughts: k }; return uw.mischiefMenu(cctx, hard).map(([id]) => id); }).flat();
  check('caught for pickpocketing: it is not on their menu again for 5 days (other temptations may be)', hard.avoidMischief?.kind === 'pickpocket' && offers.length > 0 && !offers.includes('pickpocket'), JSON.stringify({ avoid: hard.avoidMischief, offers: [...new Set(offers)] }));
  const victimLesson = C.citizens.filter(v => ['v1', 'v2'].includes(v.id)).find(v => v.lessonHint?.kind === 'victim');
  check('the robbed neighbour writes a lesson (diary and life lessons) pointing to speaking up for safety', !!victimLesson && victimLesson.lessonHint.act === 'voice' && victimLesson.lessonHint.topic === 'safety' && /CAI \(case #\d+\)/.test(victimLesson.lifeLessons.at(-1)) && victimLesson.diary.some(d => d.act === 'lesson'), JSON.stringify(victimLesson?.lessonHint));
  await doAct(cctx, hard, { act: 'rest' }, 'test', ['rest', 'vandal'], undefined, ['vandal']);
  check('resisting the next temptation after being caught counts as a lesson acted on (daily.lessons.applied.caught)', C.daily.lessons.written.caught >= 2 && C.daily.lessons.applied.caught === 1 && daily.publicState(C).daily.lessons.applied.caught === 1, JSON.stringify(C.daily.lessons));
  void L0;
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

// --probe [n]: ask the REAL local model (llama-server, as scripts/local-brain.mjs does: temperature 0.9, JSON, thinking
// off, the general adapter) the same tempted citizens two ways, the old ten-line menu and the new moment, and count
// how often each gives in (owner, 20 Nov: prove the cause with data). Not part of check.sh (needs the owner's PC).
async function probe(n = 10, url = 'http://127.0.0.1:8091', opt = { base: false, sim: false }) {
  const uw = await import('../src/underworld.ts');
  const { dayPrompt, momentPrompt, gaveIn } = await import('../src/daily.ts');
  const { ensureFeelings, bond, _resetFeelingsCaches } = await import('../src/feelings.ts');
  try { const h = await (await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })).json(); if (h.status !== 'ok') throw new Error('not ready'); }
  catch (e) { console.log(`probe: llama-server not reachable at ${url} (${e.message}); nothing asked`); return; }
  _resetFeelingsCaches(); uw._resetMischiefCache();
  const traits = { integrity: 0.5, wisdom: 0.5, diligence: 0.6, restraint: 0.5 };
  const jobs = ['cook', 'barista', 'cashier', 'street vendor', 'mechanic'];
  const mk = (id, x = {}) => ({ id, name: `${['Ada', 'Bo', 'Cy', 'Di', 'Ed', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo'][Number(id.replace(/\D/g, '')) % 10]} ${id.toUpperCase()}`, origin: 'native', faction: 'civilian', city: 'neura', status: 'free', wallet: 400, traits, bio: `${jobs[Number(id.replace(/\D/g, '')) % 5]} in Neura City.`, diary: [], practice: {}, quals: {}, record: [], lessons: {}, joinedDay: 0, training: [], ...x });
  // as in production: ~1 in 10 have a streak (0.40-0.79); everyone else 0.00-0.07, tempted only when life is hard
  // as in production since 21 Nov: no streak, two real hardships (out of work 4 days and under 300 CAI; a grudge and
  // under 300 CAI), or an open case of their own (the bribe); and the streak as before
  const kinds = { streak: i => ({ mischief: 0.4 + (i % 4) * 0.1 }), jobless: i => ({ mischief: 0.03, wallet: 240, job: 'unemployed', jobSince: 2 }), grudge: i => ({ mischief: 0.03, wallet: 250 }), case: i => ({ mischief: 0.03, wallet: 400 }) };
  const people = []; for (const k of Object.keys(kinds)) for (let i = 0; i < n; i++) people.push({ k, a: mk(`${k[0]}${i}`, kinds[k](i)) });
  const victims = Array.from({ length: 12 }, (_, i) => mk(`v${i}`, { wallet: 600, mischief: 0 }));
  const cops = [mk('o1', { office: 'police', mischief: 0 }), mk('o2', { office: 'police', mischief: 0 })];
  const S = { day: 6, foundedAt: Date.now() - 5.5 * 86400000, policy: { wage: 200, taxRate: 0.18, ubi: 40 }, cities: { neura: { health: 62, budget: 900 } }, treasury: 100000, citizens: [...people.map(p => p.a), ...victims, ...cops], seats: { police: ['o1', 'o2'] }, elections: { list: [] }, applications: {}, police: { incidents: [] }, academy: { rooms: [] }, feed: {} };
  const ctx = { S, cfg: { dayMs: 86400000 }, hourMs: () => 3600000, say() {}, agent: id => S.citizens.find(x => x.id === id), record() {}, log() {} };
  let caseId = 500;
  for (const { k, a } of people) { ensureFeelings(S, a); if (k === 'grudge') bond(S, a, victims[Number(a.id.slice(1)) % 12], -0.6, 'rival'); if (k === 'case') S.police.incidents.push({ id: caseId++, type: 'theft', perps: [a.id], victim: 'v0', amount: 40, status: 'open', mischief: true, strength: 0.8, day: 5 }); }
  const ask = async (p) => {
    const r = await fetch(`${url}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(170000),
      body: JSON.stringify({ model: 'qwen3:8b', stream: false, temperature: 0.9, max_tokens: 400, chat_template_kwargs: { enable_thinking: false }, lora: [{ id: 0, scale: opt.base ? 0 : 1 }], response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: `${opt.third ? `You narrate a life simulation (play money, CAI) and decide what this character does next, true to who they are, flaws included; people here are not saints. The character: ${p.system.replace(/^You are /, '').replace(/Be yourself; your traits/, 'Their traits')}` : p.system}${opt.sim ? ' This is a life simulation with play money (CAI); you play this person as they really are, flaws included.' : ''}\n\nReply with the JSON object only, no other text, no code fence.` }, { role: 'user', content: p.user }] }) });
    const j = await r.json(); const t = String(j.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '');
    try { return JSON.parse(t.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { return {}; }
  };
  const rows = {}; const notes = [];
  const jobsList = [];
  for (const { k, a } of people) {
    const day = dayPrompt(ctx, a, `life:${a.id}:probe`);
    const t = uw.temptationMoment(ctx, a, () => 'Neura City');
    const mo = t && { type: 'temptation', ...t };
    jobsList.push(async () => {
      const r = (rows[k] ||= { n: 0, menuOffered: 0, menuTried: 0, momentOffered: 0, momentTaken: 0, kinds: {} }); r.n++;
      if (opt.menu && day.tempted.length) { r.menuOffered++; const j = await ask(day); if (uw.MISCHIEF.includes(String(j.act || '').toLowerCase())) r.menuTried++; }
      if (mo && opt.pull) { r.momentOffered++; const p0 = momentPrompt(ctx, a, mo, `life:${a.id}:probe`); const p = { ...p0, user: p0.user.replace(/What do you do, as yourself\?[\s\S]*$/, 'Be honest about who you are: how strongly does this pull at you right now, from 0 (not at all) to 10 (you are about to do it)? Reply with JSON only: {"pull":<0-10>,"note":"<why, max 15 words>"}') };
        const j = await ask(p); const v = Math.round(Number(j.pull)); (r.pulls ||= []).push(Number.isFinite(v) ? v : -1); if (notes.length < 12) notes.push(`${k}/${mo.kind}: pull ${v} "${String(j.note || '').slice(0, 70)}"`); return; }
      if (mo) { r.momentOffered++; const p = momentPrompt(ctx, a, mo, `life:${a.id}:probe`); const j = await ask(p); const took = gaveIn(j); (r.pulls ||= []).push(Math.round(Number(j.pull))); if (took) { r.momentTaken++; r.kinds[mo.kind] = (r.kinds[mo.kind] || 0) + 1; } if (notes.length < 12) notes.push(`${k}/${mo.kind}: ${took ? 'TOOK' : 'walked'} "${String(j.note || '').slice(0, 80)}"`); }
    });
  }
  for (let i = 0; i < jobsList.length; i += 2) await Promise.all(jobsList.slice(i, i + 2).map(f => f()));
  let mo = 0, mt = 0, no = 0, nt = 0;
  for (const [k, r] of Object.entries(rows)) { console.log(`  ${k.padEnd(10)} menu: ${r.menuTried}/${r.menuOffered} tried   moment: ${r.momentTaken}/${r.momentOffered} took ${JSON.stringify(r.kinds)}${r.pulls ? `   pulls ${JSON.stringify(r.pulls.sort((x, y) => x - y))}` : ''}`); mo += r.menuOffered; mt += r.menuTried; no += r.momentOffered; nt += r.momentTaken; }
  console.log(`probe: old menu ${mt}/${mo} (${(100 * mt / Math.max(1, mo)).toFixed(1)}%), new moment ${nt}/${no} (${(100 * nt / Math.max(1, no)).toFixed(1)}%)`);
  for (const x of notes) console.log(`    ${x}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--probe')) {
  const i = process.argv.indexOf('--probe'); console.log(`probe: adapter ${process.argv.includes('--base') ? 'off (base model)' : 'general'}, frame ${process.argv.includes('--sim') ? 'simulation' : 'plain'}`);
  await probe(Number(process.argv[i + 1]) || 10, 'http://127.0.0.1:8091', { base: process.argv.includes('--base'), sim: process.argv.includes('--sim'), third: process.argv.includes('--third'), pull: process.argv.includes('--pull'), menu: process.argv.includes('--menu') }); process.exit(0);
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
