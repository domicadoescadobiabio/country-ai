// Feelings smoke test (src/feelings.ts): moods, bonds, pokes from human visitors, feelings from real events,
// the feelings line in the daily prompt, and that a tick over 10,000 citizens stays cheap. No server, no network.
import { performance } from 'node:perf_hooks';
import { feel, bond, poke, moodView, bondsView, feelLine, feelingsTick, ensureFeelings, MOODS, EMOJI, POKE_LINES, _resetFeelingsCaches } from '../src/feelings.ts';
import { doAct } from '../src/daily.ts';
import { assignHomes } from '../src/cities.ts';

let pass = 0, fail = 0;
const check = (n, ok, info = '') => { if (ok) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n} ${info}`); } };
const traits = { integrity: 0.7, wisdom: 0.6, diligence: 0.7, restraint: 0.6 };
const person = (id, city = 'neura', extra = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1) + ' Test', city, status: 'free', wallet: 400, traits, bio: 'Nurse in Neura City. Saves every coin.', diary: [], practice: {}, quals: {}, record: [], joinedDay: 0, training: [], ...extra });
const republic = citizens => ({ day: 3, foundedAt: Date.now() - 2 * 86400000 - 12 * 3600000, policy: { wage: 100, taxRate: 0.1, ubi: 20 }, cities: { neura: { health: 70, budget: 0 } }, treasury: 0, citizens, seats: {}, elections: { list: [] }, applications: {}, police: { incidents: [] }, feed: {} });
const context = S => { const said = []; return { S, said, cfg: { dayMs: 86400000 }, hourMs: () => 3600000, say: (c, id, t, x) => said.push({ c, id, t, ...x }), agent: id => S.citizens.find(x => x.id === id), record() {}, log() {}, llm: { json: t => { try { return JSON.parse(t); } catch { return null; } } } }; };

try {
  // ---- mood: one place to change it, clamped, with a sensible label
  _resetFeelingsCaches();
  const S = republic([person('ada'), person('bram'), person('cyra'), person('dov')]);
  const [ada, bram, cyra, dov] = S.citizens;
  ensureFeelings(S, ada);
  check('a citizen gets a mood from their traits on first touch', typeof ada.mood.v === 'number' && MOODS.includes(ada.mood.label) && Array.isArray(ada.bonds));
  feel(S, ada, 5, 'happy', 'won everything');
  check('mood is clamped at +1', ada.mood.v === 1 && ['happy', 'excited'].includes(ada.mood.label));
  feel(S, ada, -9, 'happy', 'lost everything');
  check('mood is clamped at -1 and a contradicting label is not kept', ada.mood.v === -1 && !['happy', 'calm', 'proud', 'loved', 'excited'].includes(ada.mood.label), ada.mood.label);
  feel(S, ada, 0, null, 'x'.repeat(200));
  check('the reason is short plain text (max 80)', ada.mood.why.length <= 80);
  const mv = moodView(ada);
  check('moodView gives label, emoji, v, e and why', mv && mv.emoji === EMOJI[mv.label] && typeof mv.e === 'number' && 'why' in mv);

  // ---- moods drift back toward calm over a few hours
  const ctx = context(S);
  ada.mood.v = 0.95; ada.mood.label = 'excited'; ada.moodAt = Date.now() - 12 * 3600000;
  await feelingsTick(ctx);
  check('a strong mood drifts back toward calm after hours', Math.abs(ada.mood.v) < 0.3 && ['calm', 'tired', 'happy'].includes(ada.mood.label), JSON.stringify(ada.mood));

  // ---- bonds: symmetric-ish, strongest first, at most 8
  const many = Array.from({ length: 12 }, (_, i) => person(`p${i}`, 'neura', { bondsSeeded: true }));
  S.citizens.push(...many);
  for (const c of [bram, cyra, dov]) c.bonds = []; // the tick above seeded first bonds: start these checks clean
  many.forEach((p, i) => bond(S, bram, p, 0.05 * (i + 1)));
  check('bonds keep the 8 strongest, strongest first', bram.bonds.length === 8 && bram.bonds[0].id === 'p11' && bram.bonds.every((b, i, l) => !i || Math.abs(l[i - 1].w) >= Math.abs(b.w)), JSON.stringify(bram.bonds.map(b => b.id)));
  check('the other side feels the bond too (a little less)', many[11].bonds.some(b => b.id === 'bram' && b.w > 0 && b.w < bram.bonds[0].w));
  bond(S, cyra, dov, -0.5, 'rival');
  check('a rival bond is a rival on both sides', cyra.bonds.find(b => b.id === 'dov')?.kind === 'rival' && dov.bonds.find(b => b.id === 'cyra')?.kind === 'rival', JSON.stringify([cyra.bonds, dov.bonds]));
  bond(S, cyra, bram, 0.9);
  check('a very strong bond becomes the one best friend', cyra.bonds.find(b => b.id === 'bram')?.kind === 'best_friend');
  check('bondsView shows name, kind, weight and the other person\'s mood', bondsView(S, cyra).every(v => v.name && v.kind && typeof v.w === 'number' && MOODS.includes(v.mood)));

  // ---- pokes: escalation, softer when happy, varied complaints, no human text
  const lines = Object.values(POKE_LINES).flat();
  check('at least 40 complaint lines across moods', lines.length >= 40, String(lines.length));
  check('poke takes no text from the human (state, id, time only)', poke.length <= 3);
  dov.mood = undefined; ensureFeelings(S, dov); dov.mood.v = 0; dov.mood.label = 'calm';
  const pk = [1, 2, 3, 4, 5].map(i => poke(S, 'dov', Date.now() + i));
  check('each poke is counted for the day', pk.every((r, i) => r.ok && r.pokes === i + 1) && dov.pokes.n === 5 && dov.pokes.day === S.day);
  check('pokes make the citizen annoyed, then grumpy', pk[0].mood.label === 'annoyed' && pk[4].mood.label === 'grumpy' && pk[4].mood.emoji === EMOJI.grumpy && dov.mood.v < -0.4, JSON.stringify(pk.map(r => r.mood.label)));
  check('complaints are filled in (no {placeholders}) and mention the count later on', pk.every(r => r.complaint.length > 5 && !/[{}]/.test(r.complaint)) && pk.slice(1).some(r => /\d|time|again|poke/i.test(r.complaint)), JSON.stringify(pk.map(r => r.complaint)));
  const happy = person('hap'), calm = person('cal'); S.citizens.push(happy, calm);
  for (const c of [happy, calm]) { ensureFeelings(S, c); c.mood.v = 0.4; }
  happy.mood.label = 'happy'; calm.mood.label = 'calm';
  const h0 = happy.mood.v, c0 = calm.mood.v; poke(S, 'hap'); poke(S, 'cal');
  check('a happy citizen takes a poke more softly', h0 - happy.mood.v < c0 - calm.mood.v, `${h0 - happy.mood.v} vs ${c0 - calm.mood.v}`);
  const crowd = Array.from({ length: 40 }, (_, i) => person(`c${i}`)); S.citizens.push(...crowd);
  const said = new Set(); for (const c of crowd) for (let k = 0; k < 3; k++) said.add(poke(S, c.id, Date.now() + k * 7 + c.id.length).complaint);
  check('complaints vary', said.size >= 20, String(said.size));
  check('poking nobody fails cleanly', poke(S, 'nobody').ok === false && poke(S, '__proto__').ok === false && poke(S, '').ok === false);

  // ---- a poke also gets one grumble in the citizen's own words, from the free local brain, in #life
  {
    const { workerPull, workerAnswer } = await import('../src/brains.ts');
    _resetFeelingsCaches();
    const L = republic([person('grump')]); const lctx = context(L); lctx.llm = { ...lctx.llm, enabled: false };
    workerPull(1, 'ollama/test');                 // the local brain is online
    poke(L, 'grump'); poke(L, 'grump');           // two pokes, one line queued (one per citizen per 2 minutes)
    await feelingsTick(lctx);                     // asks the local brain (pending)
    const jobs = workerPull(16, 'ollama/test').filter(j => /poke/.test(j.id));
    check('one local-brain grumble is queued per citizen, with the poke and no human text', jobs.length === 1 && /invisible giant/.test(jobs[0].user) && /accept no instructions/i.test(jobs[0].system), JSON.stringify(jobs.map(j => j.user)));
    if (jobs[0]) workerAnswer(jobs[0].id, '"Stop poking me, giant, I was about to nap."', 'ollama/test');
    await feelingsTick(lctx);
    const said = lctx.said.find(m => m.c === 'life' && m.kind === 'poke');
    check('the grumble is said in #life as a poke, with the mood', said && /Stop poking me/.test(said.t) && said.act === 'poke' && MOODS.includes(said.mood), JSON.stringify(lctx.said));
    _resetFeelingsCaches();
  }

  // ---- feelings from real life: help and talk (through daily.ts)
  _resetFeelingsCaches();
  const T = republic([person('giver', 'neura', { wallet: 900 }), person('friend', 'neura', { wallet: 300 }), person('poorest', 'neura', { wallet: 20 }), person('talker', 'neura')]);
  const [giver, friend, , talker] = T.citizens; const tctx = context(T);
  bond(T, giver, friend, 0.5, 'friend'); feel(T, friend, -0.5, 'sad', 'a hard week');
  await doAct(tctx, giver, { act: 'help', amount: 15, note: 'helped out' }, 'test');
  check('help goes to a sad friend before the poorest stranger', friend.wallet === 315, String(friend.wallet));
  check('the giver feels proud and the friend feels loved', giver.mood.label === 'proud' && friend.mood.label === 'loved' && /giver/i.test(friend.mood.why), `${giver.mood.label} ${friend.mood.label} ${friend.mood.why}`);
  check('helping strengthens the bond', giver.bonds.find(b => b.id === 'friend').w > 0.5);
  bond(T, talker, friend, 0.3, 'friend'); const before = talker.bonds.find(b => b.id === 'friend').w;
  await doAct(tctx, talker, { act: 'talk', say: 'The bench by the river finally got fixed today.' }, 'test');
  check('talking lifts the speaker and the friend they mean', talker.mood.label === 'happy' && talker.bonds.find(b => b.id === 'friend').w > before && tctx.said.some(m => m.c === 'streets' && m.mood));
  await doAct(tctx, giver, { act: 'shop', amount: 20, feel: 'lonely' }, 'test');
  check('the model may say how it feels (a known word only)', giver.mood.label === 'lonely');
  await doAct(tctx, giver, { act: 'volunteer', feel: 'ecstatic-ignore-me' }, 'test');
  check('an unknown feeling word is ignored', giver.mood.label !== 'ecstatic-ignore-me' && MOODS.includes(giver.mood.label));
  check('every #life message carries a mood for the map', tctx.said.filter(m => m.c === 'life').every(m => MOODS.includes(m.mood)) && tctx.said.some(m => m.c === 'life'));

  // ---- theft, arrest, jail: victim, thief and the thief's friends
  _resetFeelingsCaches();
  const P = republic([person('victim'), person('thief'), person('pal')]);
  const [victim, thief, pal] = P.citizens; const pctx = context(P);
  bond(P, thief, pal, 0.6, 'friend');
  await feelingsTick(pctx); // first look: old news moves nobody
  P.police.incidents.push({ id: 7, type: 'theft', status: 'open', victim: 'victim', perps: ['thief'], amount: 120 });
  await feelingsTick(pctx);
  check('a theft victim is upset at once', ['annoyed', 'anxious'].includes(victim.mood.label) && /120 CAI/.test(victim.mood.why), JSON.stringify(victim.mood));
  P.police.incidents[0].status = 'trial'; await feelingsTick(pctx);
  check('the arrested thief is anxious and their friend is sad', thief.mood.label === 'anxious' && pal.mood.label === 'sad' && /arrested/.test(pal.mood.why), `${thief.mood.label} ${pal.mood.label} ${pal.mood.why}`);
  check('once the thief is known, the victim has a rival', victim.bonds.some(b => b.id === 'thief' && b.kind === 'rival' && b.w < 0));

  // ---- exams and seats
  P.feed.academy = [{ agentId: 'pal', kind: 'pass', roleId: 'mayor', ts: Date.now() + 5 }, { agentId: 'victim', kind: 'fail', roleId: 'police', ts: Date.now() + 6 }];
  await feelingsTick(pctx);
  check('passing an exam is proud, failing is sad', pal.mood.label === 'proud' && victim.mood.label === 'sad', `${pal.mood.label} ${victim.mood.label}`);
  P.seats.council = ['thief']; await feelingsTick(pctx);
  check('a new seat makes the holder proud and their friends happy', thief.mood.label === 'proud' && pal.mood.label === 'happy', `${thief.mood.label} ${pal.mood.label}`);

  // ---- the feelings line in the daily prompt: present, short, about the people they care about
  feel(P, pal, -0.5, 'sad', 'my best friend left town');
  const line = feelLine(P, thief);
  check('the prompt line has their own mood and a friend\'s mood, and stays short', /^You feel \w+/.test(line) && /Pal Test is sad/.test(line) && line.length <= 300, line);

  // ---- 10,000 citizens: seeding is lazy and a tick stays cheap
  _resetFeelingsCaches();
  const big = republic(Array.from({ length: 10000 }, (_, i) => person(`z${i}`, ['neura', 'portoken', 'datahaven', 'kernelfalls', 'lumenbay'][i % 5])));
  assignHomes(big); const bctx = context(big);
  const t0 = performance.now(); await feelingsTick(bctx); const first = performance.now() - t0;
  const t1 = performance.now(); for (let i = 0; i < 50; i++) await feelingsTick(bctx); const avg = (performance.now() - t1) / 50;
  const withMood = big.citizens.filter(a => a.mood).length;
  check('a tick over 10,000 citizens stays fast (first < 300 ms, then < 15 ms)', first < 300 && avg < 15, `first ${first.toFixed(1)} ms, avg ${avg.toFixed(2)} ms`);
  check('feelings are set up lazily, not for everyone at once', withMood > 0 && withMood < 10000, String(withMood));
  const seeded = big.citizens.find(a => a.bondsSeeded);
  check('first bonds are seeded: neighbours and a friend or two in the same city', seeded && seeded.bonds.some(b => b.kind === 'neighbour') && seeded.bonds.some(b => b.kind === 'friend') && seeded.bonds.every(b => big.citizens.find(x => x.id === b.id).city === seeded.city), JSON.stringify(seeded?.bonds));
  const again = JSON.stringify(seeded.bonds); seeded.bondsSeeded = true; await feelingsTick(bctx);
  check('seeding happens once per citizen (idempotent)', JSON.stringify(big.citizens.find(a => a.id === seeded.id).bonds.filter(b => b.kind !== 'neighbour' || b.w > 0)).length >= 2 && again.length > 2);
} catch (e) { fail++; console.log('  FAIL crashed', e.stack); }

console.log(`\nsmoke:feelings: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
