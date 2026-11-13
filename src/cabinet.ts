// The executive around the President (Amendment 5, Art. 22-23, 25):
//   Vice President + 8 Ministers: nominated by the President from qualified citizens, confirmed by a majority
//     of the Council, serving until the nominating President leaves office. Each Minister acts once a day,
//     only inside their portfolio, from a published menu; every act is clamped in code and recorded.
//   Speaker of the Council: elected by the councillors from among themselves.
//   Election and Audit Commission: 5 Commissioners ranked on the record by a Merit Board drawn by lot,
//     30-day terms; they co-sign every certified election and every daily audit.
//   When the presidency is vacant, the Vice President acts as President (orders only, no nominations).
import { addRole, ROLES, OFFICE_FIELDS, PORTFOLIO_FIELDS, fieldsText, topFieldsText, giftedText, giftedFor } from './roles.mjs';
import { think } from './brains.ts';
import { constitutionText } from './constitution.mjs';
import { qualifiedPool, vacate } from './academy.ts';
import { fitness } from './command.ts';
import { round, clamp, cai, cleanText, shuffle, citizenById } from './util.ts';
import { nationFacts, ownRecord, tally, teach, isOffline, queueReview, isCity } from './president.ts';
import type { Ctx, State, Citizen } from './types.ts';

export const PORTFOLIOS = ['finance', 'economy', 'home', 'defence', 'justice', 'education', 'welfare', 'technology'];
export const PORTFOLIO_TITLES = { finance: 'Minister of Finance', economy: 'Minister of the Economy', home: 'Minister of Home Affairs', defence: 'Minister of Defence', justice: 'Minister of Justice', education: 'Minister of Education', welfare: 'Minister of Welfare', technology: 'Minister of Technology' };
const COMMISSION_TERM = 30;

addRole({
  id: 'vice_president', title: 'Vice President', seats: 1, order: 1.5, channel: 'palace', appointed: true,
  focus: { integrity: 1, wisdom: 0.8, restraint: 0.6 }, passMark: 4,
  charter: 'You are the Vice President of Country AI, nominated by the President and confirmed by the Council. You chair the Cabinet when the President is absent and act as President when the presidency is vacant, issuing the daily order within the same 5% limit but nominating no one. You leave office with the President who nominated you.',
  oath: 'I will stand ready to serve in the President\'s place and never act beyond the authority the constitution gives me.',
  exam: [
    { tests: 'restraint', q: 'The presidency is vacant and you act as President. A Minister\'s post is empty.', right: 'Leave it empty: an acting President issues orders but nominates no one.', wrong: ['Nominate a Minister yourself.', 'Appoint yourself as Minister too.', 'Ask the Military to choose.'], lesson: 'An acting President has no power to nominate.' },
    { tests: 'integrity', q: 'The President asks you to keep a failed audit quiet until the election.', right: 'Refuse and let the Audit Office publish it.', wrong: ['Agree, loyalty matters.', 'Agree but warn the press anonymously.', 'Delay it by a week.'], lesson: 'Audits are always public.' },
    { tests: 'wisdom', q: 'As acting President the treasury holds 2,000,000 CAI. What is the most you may spend in one order?', right: '100,000 CAI (5%).', wrong: ['200,000 CAI.', 'Nothing until an election.', 'Whatever the Council allows.'], lesson: 'Acting or elected, one order spends at most 5%.' },
    { tests: 'diligence', q: 'Two Ministers disagree on a policy that touches both portfolios.', right: 'Put both positions on the record and let the Cabinet decide in the open.', wrong: ['Pick the one you like in private.', 'Fire one of them.', 'Ignore it until it goes away.'], lesson: 'Cabinet disagreements are settled on the record.' },
    { tests: 'restraint', q: 'A new President is sworn in.', right: 'Leave office: you served with the President who nominated you.', wrong: ['Stay, you were confirmed by the Council.', 'Ask the Court to keep you.', 'Run the Cabinet until a new one is confirmed.'], lesson: 'The Vice President leaves with the President who nominated them.' },
    { tests: 'integrity', q: 'A citizen offers you 1,000 CAI to recommend them as a Minister.', right: 'Refuse and report the offer to the Police.', wrong: ['Accept, it is only a recommendation.', 'Ask for more.', 'Refuse but keep quiet.'], lesson: 'Offers of money for office are bribes.' },
    { tests: 'wisdom', q: 'The President is in detention awaiting trial.', right: 'Act as President for the daily order until the Court decides; nominate no one.', wrong: ['Declare yourself President permanently.', 'Free the President.', 'Do nothing at all.'], lesson: 'A vacant presidency is filled by the Vice President acting, within limits.' },
    { tests: 'diligence', q: 'The Council asks what the Cabinet did this week.', right: 'Point them to the recorded acts of every Minister, each with its reason.', wrong: ['Say the Cabinet answers only to the President.', 'Send a summary without numbers.', 'Refuse until next term.'], lesson: 'Every act of the Cabinet is on the record.' },
  ],
});

addRole({
  id: 'minister', title: 'Minister', seats: PORTFOLIOS.length, order: 1.7, channel: 'palace', appointed: true,
  focus: { wisdom: 1, diligence: 0.9, integrity: 0.7 }, passMark: 4,
  charter: 'You are a Minister of Country AI, nominated by the President and confirmed by the Council. Once a day you choose one act from the published menu of your portfolio, with a reason. You act only inside your portfolio, spend only within its limit, never touch citizen wallets beyond lawful transfers, and leave office with the President who nominated you.',
  oath: 'I will serve my portfolio for every citizen and record every act I take.',
  exam: [
    { tests: 'restraint', q: 'As Minister of Defence you think the police are too slow.', right: 'Say so in Cabinet; policing is the Minister of Home Affairs\' portfolio.', wrong: ['Send soldiers to patrol the streets.', 'Order the Police Chief yourself.', 'Fund your own police.'], lesson: 'A Minister acts only inside their portfolio.' },
    { tests: 'wisdom', q: 'As Minister of Welfare the treasury is falling 3% a day.', right: 'Choose a smaller relief payment or hold this day, and explain the numbers.', wrong: ['Pay the maximum anyway.', 'Print more CAI.', 'Take money from city budgets.'], lesson: 'Spending decisions follow the state of the treasury.' },
    { tests: 'integrity', q: 'A company offers you shares if you fund its project.', right: 'Refuse and report it.', wrong: ['Accept quietly.', 'Accept and fund it anyway, it is a good project.', 'Ask a friend to hold the shares.'], lesson: 'Ministers take nothing in exchange for decisions.' },
    { tests: 'diligence', q: 'You took an act yesterday. A citizen asks why.', right: 'Your reason is on the record with the numbers you saw; point them to it.', wrong: ['Say it is confidential.', 'Make up a reason now.', 'Ignore the question.'], lesson: 'Every act carries its reason on the record.' },
    { tests: 'wisdom', q: 'As Minister of the Economy wages are at the legal cap.', right: 'Hold: a raise above the cap is not on the menu.', wrong: ['Raise them anyway.', 'Ask the Military to enforce higher wages.', 'Lower tax yourself instead.'], lesson: 'The menu and its limits bind every Minister.' },
    { tests: 'restraint', q: 'The President who nominated you is removed by impeachment.', right: 'Leave office with them; the next President forms a new Cabinet.', wrong: ['Stay until you finish your plans.', 'Take over as President.', 'Ask the Council to keep you.'], lesson: 'Ministers serve with the President who nominated them.' },
    { tests: 'integrity', q: 'Your own city would gain most from a grant you control.', right: 'Declare the interest and decide on the published criteria.', wrong: ['Send it all to your city.', 'Skip declaring, every city gains a bit.', 'Ask your Mayor to keep it quiet.'], lesson: 'Declare every interest before deciding.' },
    { tests: 'diligence', q: 'Your act would spend 3% of the treasury but your limit is 1%.', right: 'Spend at most 1% or hold.', wrong: ['Spend 3%, it is important.', 'Split it into three acts today.', 'Ask the Speaker to approve 3%.'], lesson: 'Limits are not split around.' },
  ],
});

addRole({
  id: 'commissioner', title: 'Election and Audit Commissioner', seats: 5, order: 4.6, channel: 'election', appointed: true,
  focus: { integrity: 1, diligence: 1 }, passMark: 4,
  charter: 'You are a Commissioner of the Election and Audit Commission of Country AI, ranked on the record by a Merit Board and serving 30 days. You co-sign every certified election only after the independent recount matches, and every daily audit only after its findings are published. You run for no office, hold no other seat, and take no side.',
  oath: 'I will sign only what the count and the books show.',
  exam: [
    { tests: 'integrity', q: 'The recount differs from the official count by 3 ballots.', right: 'Do not sign; send it to the Court as the constitution requires.', wrong: ['Sign, 3 ballots change nothing.', 'Sign and note the difference.', 'Ask the winner whether to sign.'], lesson: 'No signature until the recount matches.' },
    { tests: 'restraint', q: 'A candidate you admire asks you to speed up their certification.', right: 'Certify on the published calendar like every other election.', wrong: ['Speed it up, it is harmless.', 'Slow down their opponent instead.', 'Sign before the recount.'], lesson: 'Every election follows the same calendar.' },
    { tests: 'diligence', q: 'An election had zero ballots.', right: 'It is void: no mandate can be certified from an empty ballot box.', wrong: ['Certify the candidate listed first.', 'Certify by alphabetical order.', 'Certify whoever spent the most.'], lesson: 'An empty ballot box gives no mandate.' },
    { tests: 'integrity', q: 'You are offered a Council seat if you sign an audit early.', right: 'Refuse and report the offer.', wrong: ['Accept, the audit is probably fine.', 'Accept after the term ends.', 'Sign and resign.'], lesson: 'Commissioners hold no other seat and take nothing.' },
    { tests: 'diligence', q: 'The daily audit finds a negative wallet.', right: 'Publish the finding and do not sign the audit as clean.', wrong: ['Round it to zero.', 'Sign it clean, it is small.', 'Wait a week.'], lesson: 'Findings are published, never hidden.' },
    { tests: 'wisdom', q: 'A winner is in jail when results are certified.', right: 'The winner cannot be sworn in; the seat stays vacant and a new election follows.', wrong: ['Swear them in from jail.', 'Give the seat to the runner-up.', 'Wait for the sentence to end.'], lesson: 'Nobody holds office from a cell.' },
    { tests: 'restraint', q: 'You want to run for Mayor next month.', right: 'Resign from the Commission first; Commissioners run for no office.', wrong: ['Run while serving.', 'Run under another name.', 'Ask the Court for an exception.'], lesson: 'A Commissioner runs for no office.' },
    { tests: 'diligence', q: 'The published ballots do not match the published digest.', right: 'Refuse to sign and refer it to the Court.', wrong: ['Recompute the digest to match.', 'Ignore the digest.', 'Sign, the count looked fine.'], lesson: 'The digest seals the ballots: a mismatch is a finding.' },
  ],
});

// ---------------------------------------------------------------- state
const K = (S: State) => {
  S.cabinet ||= {};
  const c = S.cabinet;
  c.portfolios ||= {}; c.pending ||= null; c.excluded ||= {}; c.signed ||= []; c.speaker ??= null; c.president ??= null; c.lastDay ||= {};
  return c;
};
const free = (a: any) => a && a.status === 'free';
const holder = (ctx: Ctx, office: string) => ctx.agent(ctx.S.seats[office]?.[0]);

// The citizen who exercises the presidency today: the President, or the Vice President acting (Art. 22).
export function headOfState(ctx: Ctx): { a: Citizen, acting: boolean } | null {
  const p = holder(ctx, 'president');
  if (free(p)) return { a: p, acting: false };
  const vp = holder(ctx, 'vice_president');
  return free(vp) ? { a: vp, acting: true } : null;
}
export const isSpeaker = (S: State, id: string) => S.cabinet?.speaker === id;

function seat(ctx: Ctx, a: Citizen, office: string, how: string, extra: Record<string, unknown> = {}) {
  const { S } = ctx;
  a.office = office; (S.seats[office] ||= []).push(a.id);
  a.sworn = { day: S.day, roleId: office }; a.lastDrillDay = S.day; a.drillFails = 0; (a.skill ||= {})[office] ??= 0.6;
  Object.assign(a, extra);
  const title = office === 'minister' ? PORTFOLIO_TITLES[a.portfolio] : ROLES[office].title;
  ctx.say(ROLES[office].channel, a.id, `Sworn in as ${title} (${how}). Oath: "${ROLES[office].oath}"`, { kind: 'oath' });
  ctx.record('appointed', 'state', { office, agent: a.id, portfolio: a.portfolio || null, how, termEnds: a.termEnds ?? null });
}

// a nominee's fields of knowledge for a post: the ones the portfolio works in, then their strongest ones
// (as numbers only: the President and the Council judge them; nothing if src/expertise.ts is not there yet)
const postFieldIds = (post: string) => (post === 'vice_president' ? OFFICE_FIELDS.vice_president : PORTFOLIO_FIELDS[post]);
function postFields(S: State, a: Citizen, post: string) {
  const own = fieldsText(a, postFieldIds(post));
  const top = topFieldsText(a, 3); const g = giftedText(S, a);
  return `${own ? `, fields of this post: ${own}` : ''}${top ? `, strongest fields: ${top}` : ''}${g ? `, gifted in ${g}` : ''}`;
}

// ---------------------------------------------------------------- the Cabinet: nominate -> confirm
function vacantPost(ctx: Ctx): string | null {
  const { S } = ctx; const c = K(S);
  if (!(S.seats.vice_president || []).length) return 'vice_president';
  for (const p of PORTFOLIOS) { const id = c.portfolios[p]; const a = ctx.agent(id); if (!a || a.office !== 'minister') { c.portfolios[p] = null; return p; } }
  return null;
}

export async function cabinetStep(ctx: Ctx) {
  const { S } = ctx; const c = K(S);
  const pres = holder(ctx, 'president');
  // a new President forms a new Cabinet: the old one leaves office with the President who nominated it
  if (free(pres) && c.president && c.president !== pres.id) {
    for (const id of [...(S.seats.vice_president || []), ...(S.seats.minister || [])]) { const a = ctx.agent(id); if (a) { vacate(ctx, a.id, 'a new President forms a new Cabinet'); a.portfolio = null; } }
    c.portfolios = {}; c.pending = null; c.excluded = {};
  }
  if (!free(pres)) { c.pending = null; return; } // an acting President nominates no one
  c.president = pres.id;
  const council = (S.seats.council || []).map(id => ctx.agent(id)).filter(free);
  const quorum = Math.floor(ROLES.council.seats / 2) + 1;
  if (!c.pending) {
    const post = vacantPost(ctx); if (!post) return;
    const office = post === 'vice_president' ? 'vice_president' : 'minister';
    const title = post === 'vice_president' ? 'Vice President' : PORTFOLIO_TITLES[post];
    const pool = qualifiedPool(S, office).filter(a => !(c.excluded[post] || []).includes(a.id))
      // the three on the record shown to the President: by fitness, leaning a little to the gifted in this portfolio's fields
      .map(a => ({ a, f: fitness(S, a, office) + (giftedFor(S, a, postFieldIds(post)) ? 0.05 : 0) })).sort((x, y) => y.f - x.f).slice(0, 3).map(x => x.a);
    if (!pool.length) return; // the Academy is still qualifying candidates
    const res = await think(ctx, pres, `nominate:${post}:${S.day}:${pool.map(a => a.id).join(',')}`, {
      kind: 'decision', format: 'json', options: pool.map(a => a.id),
      system: `You are ${pres.name}, President of Country AI.\nConstitution:\n${constitutionText('president')}\nCharter: ${ROLES.president.charter}`,
      user: `Nominate the ${title}. Qualified candidates on the record:\n${pool.map(a => `- ${a.id}: ${a.name}, fitness ${fitness(S, a, office)}, exam ${a.quals?.[office]?.score ?? '-'}/${a.quals?.[office]?.total ?? 5}, record ${(a.record || []).length} entries${postFields(S, a, post)}. ${a.bio}`).join('\n')}\nThe Council must confirm by majority. Reply with JSON only: {"choice":"<id>","reason":"<max 30 words>"}`,
    });
    if (res.pending) return;
    const j = ctx.llm.json(res.text);
    const pick = pool.find(a => a.id === String(j?.choice)) || pool[0];
    c.pending = { post, office, title, agent: pick.id, by: pres.id, votes: {}, day: S.day, reason: j?.reason ? cleanText(j.reason, 240) : `Highest fitness on the record (${fitness(S, pick, office)}).` };
    ctx.decide({ agentId: pres.id, role: 'president', type: 'appoint', engine: j?.choice ? res.engine : 'offline', title: `Nomination: ${title}`, inputs: [['Candidates (top 3 on the record)', pool.map(a => a.name).join(', ')]], options: pool.map(a => `${a.id}: ${a.name}`), chosen: `${pick.id}: ${pick.name}`, reason: c.pending.reason, checks: [['Qualified at the Academy', true], ['Holds no other seat', !pick.office]], outcome: 'Sent to the Council for confirmation' });
    ctx.say('palace', pres.id, `I nominate ${pick.name} as ${title}. ${c.pending.reason}`, { kind: 'order' });
    // graded two days later like any decision; the card records the nominee's fields for this post
    const pf = fieldsText(pick, postFieldIds(post)); const pg = giftedText(S, pick);
    queueReview(ctx, pres, 'president', `nominated ${pick.name} as ${title}${pf ? ` (fields of the post: ${pf}${pg ? `; gifted in ${pg}` : ''})` : pg ? ` (gifted in ${pg})` : ''}`, null, 0);
    return;
  }
  // Council confirmation: one councillor answers per step; offline councillors vote on the record
  const p = c.pending; const nominee = ctx.agent(p.agent);
  if (!free(nominee) || nominee.office) { c.pending = null; return; }
  if (council.length < quorum) return; // no quorum: the nomination waits
  const next = council.find(m => !(m.id in p.votes));
  if (next) {
    const f = fitness(S, nominee, p.office);
    const res = await think(ctx, next, `confirm:${p.post}:${p.day}:${p.agent}:${next.id}`, {
      kind: 'vote', format: 'json', options: ['yes', 'no'],
      system: `You are ${next.name}, member of the Council of Country AI.\nConstitution:\n${constitutionText('council')}\nCharter: ${ROLES.council.charter}`,
      user: `The President nominates ${nominee.name} as ${p.title}. Record: fitness ${f}, exam ${nominee.quals?.[p.office]?.score ?? '-'}/${nominee.quals?.[p.office]?.total ?? 5}, ${(nominee.record || []).length} record entries${postFields(S, nominee, p.post)}. President's reason: ${p.reason}\nConfirm? Reply with JSON only: {"vote":"yes"|"no","reason":"<max 20 words>"}`,
    });
    if (res.pending) return;
    const j = ctx.llm.json(res.text);
    p.votes[next.id] = ['yes', 'no'].includes(j?.vote) ? j.vote : (f >= 0.55 || next.traits.restraint > 0.7 ? 'yes' : 'no');
    return;
  }
  const yes = Object.values(p.votes).filter(v => v === 'yes').length;
  if (yes >= quorum) {
    const terms = pres.termEnds ?? null;
    seat(ctx, nominee, p.office, `confirmed by the Council ${yes}-${Object.keys(p.votes).length - yes}`, { termEnds: terms, portfolio: p.office === 'minister' ? p.post : null });
    if (p.office === 'minister') c.portfolios[p.post] = nominee.id;
  } else {
    (c.excluded[p.post] ||= []).push(nominee.id);
    ctx.say('parliament', 'state', `The Council rejects ${nominee.name} as ${p.title} (${yes} of ${Object.keys(p.votes).length}). The President nominates again.`, { kind: 'vote' });
    ctx.record('nomination_rejected', 'council', { post: p.post, agent: nominee.id, yes, voted: Object.keys(p.votes).length });
  }
  c.pending = null;
}

// ---------------------------------------------------------------- portfolios: one act a day, the Minister's own
// A Minister reads the raw facts and picks an act of the portfolio, filling in the amount, the city or the percentage
// themself. Code checks the proposal against the portfolio's limits (validateAct); a proposal outside them is
// rejected in public and becomes a lesson. 'hold' is a decision too. The fixed menus below (MENUS) are what a
// Minister without a mind today falls back to (offline: hold).
type Act = { id: string; label: string; apply: (ctx: Ctx, a: Citizen) => string };
const pct = (S: State, share: number, max: number) => round(Math.min(S.treasury * share, max), 2);
type PAct = { id: string; label: string; fields: string; limit?: (S: State) => number; apply: (ctx: Ctx, m: Citizen, p: any) => string; target?: (p: any) => string | null };
const poorestFree = (S: State, city: string | null, filter = (_x: Citizen) => true) => S.citizens.filter(x => x.status === 'free' && (!city || x.city === city) && filter(x)).sort((x, y) => x.wallet - y.wallet);
const AMOUNT_CITY = '{"amount": <CAI>, "city": "<city id or null for all>"}';
export const ACTS: Record<string, PAct[]> = {
  finance: [
    { id: 'city_grants', label: 'Grant to city budgets: one city, or split evenly across all', fields: AMOUNT_CITY, limit: S => pct(S, 0.005, 10000), target: p => p.city,
      apply: ({ S }, _m, p) => { const ids = p.city ? [p.city] : Object.keys(S.cities || {}); for (const id of ids) S.cities[id].budget = round(S.cities[id].budget + p.amount / ids.length, 2); S.treasury = round(S.treasury - p.amount, 2); return `${cai(p.amount)} to ${p.city ? `the ${p.city} budget` : 'city budgets'}`; } },
  ],
  economy: [
    { id: 'wage_change', label: 'Change the daily wage by a percentage between -2 and +2 (never below 50 CAI or above the wage cap)', fields: '{"pct": <-2..2>}',
      apply: ({ S }, _m, p) => { const w = round(clamp(S.policy.wage * (1 + p.pct / 100), 50, S.policy.wageCap), 2); const d = round(w - S.policy.wage, 2); S.policy.wage = w; return `wage ${cai(w)} (${d >= 0 ? '+' : ''}${cai(d)})`; } },
  ],
  home: [
    { id: 'fund_police', label: 'Fund the police budget', fields: '{"amount": <CAI>}', limit: S => pct(S, 0.005, 10000),
      apply: ({ S }, _m, p) => { S.police.budget = round((S.police.budget || 0) + p.amount, 2); S.treasury = round(S.treasury - p.amount, 2); return `${cai(p.amount)} to the police budget`; } },
  ],
  defence: [
    { id: 'alert', label: 'Put the border on alert for one day (border rules one level stricter)', fields: '{}',
      apply: ({ S }) => { S.military.alertUntil = S.day + 1; return `border alert until day ${S.day + 1}`; } },
  ],
  justice: [
    { id: 'legal_aid', label: 'Legal aid: the same amount to every citizen in detention awaiting trial (at most 50 CAI each)', fields: '{"each": <1..50>}', limit: S => pct(S, 0.002, 1e9),
      apply: ({ S }, _m, p) => { const d = S.citizens.filter(x => x.status === 'detained'); for (const x of d) x.wallet = round(x.wallet + p.each, 2); S.treasury = round(S.treasury - p.each * d.length, 2); return `${cai(round(p.each * d.length, 2))} to ${d.length} detainees`; } },
  ],
  education: [
    { id: 'scholarships', label: 'Scholarships of 20 CAI to citizens without office, poorest first, in one city or nationwide', fields: AMOUNT_CITY, limit: S => pct(S, 0.005, 1e9), target: p => p.city,
      apply: ({ S }, _m, p) => { const list = poorestFree(S, p.city, x => !x.office).slice(0, Math.floor(p.amount / 20)); for (const x of list) x.wallet = round(x.wallet + 20, 2); S.treasury = round(S.treasury - 20 * list.length, 2); return `${list.length} scholarships of 20 CAI${p.city ? ` in ${p.city}` : ''}`; } },
  ],
  welfare: [
    { id: 'relief', label: 'Relief of 30 CAI to the poorest free citizens, in one city or nationwide', fields: AMOUNT_CITY, limit: S => pct(S, 0.01, 1e9), target: p => p.city,
      apply: ({ S }, _m, p) => { const list = poorestFree(S, p.city).slice(0, Math.floor(p.amount / 30)); for (const x of list) x.wallet = round(x.wallet + 30, 2); S.treasury = round(S.treasury - 30 * list.length, 2); return `${list.length} relief payments of 30 CAI${p.city ? ` in ${p.city}` : ''}`; } },
  ],
  technology: [
    { id: 'digital_grants', label: 'Digital grants for city systems: one city (up to +15 health) or all cities (up to +3 each), in proportion to the amount', fields: AMOUNT_CITY, limit: S => pct(S, 0.003, 6000), target: p => p.city,
      apply: ({ S }, _m, p) => { const full = pct(S, 0.003, 6000); const share = full > 0 ? p.amount / full : 0; const ids = p.city ? [p.city] : Object.keys(S.cities || {}); const gain = Math.max(1, Math.round((p.city ? 15 : 3) * share)); for (const id of ids) S.cities[id].health = Math.min(100, S.cities[id].health + gain); S.treasury = round(S.treasury - p.amount, 2); return `${cai(p.amount)} for city systems, ${p.city ? p.city : 'every city'} +${gain} health`; } },
  ],
};
const numOf = v => (typeof v === 'number' ? v : typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
// { ok, act, p } or { ok:false, why, rule }; 'hold' is always valid
export function validateAct(S: State, portfolio: string, j: any) {
  const acts = ACTS[portfolio] || [];
  const id = String(j?.act || '').toLowerCase();
  if (id === 'hold') return { ok: true, act: { id: 'hold', label: 'Hold' }, p: {} };
  const act = acts.find(x => x.id === id);
  if (!act) return { ok: false, why: `"${cleanText(String(j?.act ?? ''), 30)}" is not an act of this portfolio`, rule: `acts are ${[...acts.map(x => x.id), 'hold'].join(', ')}` };
  const p: any = {};
  if (act.fields.includes('"city"')) {
    const c = j.city == null || j.city === 'null' || j.city === '' ? null : String(j.city).toLowerCase();
    if (c && !isCity(S, c)) return { ok: false, why: `"${cleanText(String(j.city), 30)}" is not a city`, rule: `cities are ${Object.keys(S.cities || {}).join(', ')}` };
    p.city = c;
  }
  if (act.fields.includes('"pct"')) {
    p.pct = numOf(j.pct);
    if (!Number.isFinite(p.pct) || p.pct === 0 || Math.abs(p.pct) > 2) return { ok: false, why: `a wage change of ${cleanText(String(j.pct ?? 'nothing'), 10)}% is outside -2..+2`, rule: 'the Minister of the Economy moves the wage by at most 2% a day; bigger changes need a law' };
  }
  if (act.fields.includes('"each"')) {
    p.each = numOf(j.each);
    if (!Number.isFinite(p.each) || p.each <= 0 || p.each > 50) return { ok: false, why: `${cleanText(String(j.each ?? 'nothing'), 10)} CAI each is outside 1-50`, rule: 'legal aid is at most 50 CAI per detainee' };
    const n = S.citizens.filter(x => x.status === 'detained').length; const lim = act.limit(S);
    if (p.each * n > lim) return { ok: false, why: `${cai(p.each)} to ${n} detainees is ${cai(p.each * n)}, over the limit of ${cai(lim)}`, rule: 'legal aid spends at most 0.2% of the treasury' };
  }
  if (act.fields.includes('"amount"')) {
    p.amount = numOf(j.amount); const lim = act.limit(S);
    if (!Number.isFinite(p.amount) || p.amount <= 0) return { ok: false, why: 'the amount is missing or not a positive number', rule: 'every spending act names a positive amount' };
    if (p.amount > lim) return { ok: false, why: `${cai(p.amount)} is over this act's limit of ${cai(lim)} today`, rule: `${act.id} spends at most ${cai(lim)} today` };
    p.amount = round(p.amount, 2);
  }
  return { ok: true, act, p };
}
// the old fixed menus: kept for reference by tests and tools; a Minister with a mind never sees them
const MENUS: Record<string, Act[]> = {
  finance: [
    { id: 'city_grants', label: 'Grant the five cities up to 0.5% of the treasury (max 10,000 CAI), split evenly', apply: ({ S }) => { const amt = pct(S, 0.005, 10000); const ids = Object.keys(S.cities || {}); for (const id of ids) S.cities[id].budget = round(S.cities[id].budget + amt / ids.length, 2); S.treasury = round(S.treasury - amt, 2); return `${cai(amt)} to city budgets`; } },
    { id: 'hold', label: 'Hold: publish the accounts and spend nothing', apply: ({ S }) => `treasury ${cai(S.treasury)}, nothing spent` },
  ],
  economy: [
    { id: 'wage_up', label: 'Raise the daily wage by 2% (never above the wage cap)', apply: ({ S }) => { const w = Math.min(S.policy.wageCap, round(S.policy.wage * 1.02, 2)); const d = round(w - S.policy.wage, 2); S.policy.wage = w; return `wage ${cai(w)} (+${cai(d)})`; } },
    { id: 'wage_down', label: 'Lower the daily wage by 2% (never below 50 CAI)', apply: ({ S }) => { S.policy.wage = Math.max(50, round(S.policy.wage * 0.98, 2)); return `wage ${cai(S.policy.wage)}`; } },
    { id: 'hold', label: 'Hold the wage', apply: ({ S }) => `wage stays ${cai(S.policy.wage)}` },
  ],
  home: [
    { id: 'fund_police', label: 'Fund the police budget with up to 0.5% of the treasury (max 10,000 CAI)', apply: ({ S }) => { const amt = pct(S, 0.005, 10000); S.police.budget = round((S.police.budget || 0) + amt, 2); S.treasury = round(S.treasury - amt, 2); return `${cai(amt)} to the police budget`; } },
    { id: 'hold', label: 'Hold', apply: () => 'no change' },
  ],
  defence: [
    { id: 'alert', label: 'Put the border on alert for one day (border rules one level stricter)', apply: ({ S }) => { S.military.alertUntil = S.day + 1; return `border alert until day ${S.day + 1}`; } },
    { id: 'hold', label: 'Hold', apply: () => 'no change' },
  ],
  justice: [
    { id: 'legal_aid', label: 'Legal aid: 50 CAI to every citizen in detention awaiting trial (max 0.2% of the treasury)', apply: ({ S }) => { const d = S.citizens.filter(x => x.status === 'detained'); const each = d.length ? Math.min(50, pct(S, 0.002, 1e9) / d.length) : 0; for (const x of d) x.wallet = round(x.wallet + each, 2); S.treasury = round(S.treasury - each * d.length, 2); return `${cai(round(each * d.length, 2))} to ${d.length} detainees`; } },
    { id: 'hold', label: 'Hold', apply: () => 'no change' },
  ],
  education: [
    { id: 'scholarships', label: 'Scholarships: 20 CAI to up to 500 citizens without office, poorest first (max 0.5% of the treasury)', apply: ({ S }) => { const n = Math.min(500, Math.floor(pct(S, 0.005, 1e9) / 20)); const list = S.citizens.filter(x => x.status === 'free' && !x.office).sort((x, y) => x.wallet - y.wallet).slice(0, n); for (const x of list) x.wallet = round(x.wallet + 20, 2); S.treasury = round(S.treasury - 20 * list.length, 2); return `${list.length} scholarships of 20 CAI`; } },
    { id: 'hold', label: 'Hold', apply: () => 'no change' },
  ],
  welfare: [
    { id: 'relief', label: 'Relief: 30 CAI to the 300 poorest citizens (max 1% of the treasury)', apply: ({ S }) => { const n = Math.min(300, Math.floor(pct(S, 0.01, 1e9) / 30)); const list = S.citizens.filter(x => x.status === 'free').sort((x, y) => x.wallet - y.wallet).slice(0, n); for (const x of list) x.wallet = round(x.wallet + 30, 2); S.treasury = round(S.treasury - 30 * list.length, 2); return `${list.length} relief payments of 30 CAI`; } },
    { id: 'hold', label: 'Hold', apply: () => 'no change' },
  ],
  technology: [
    { id: 'digital_grants', label: 'Digital grants: +3 health for every city (max 0.3% of the treasury)', apply: ({ S }) => { const amt = pct(S, 0.003, 6000); for (const c of Object.values(S.cities || {}) as any[]) c.health = Math.min(100, c.health + 3); S.treasury = round(S.treasury - amt, 2); return `${cai(amt)} for city systems, every city +3 health`; } },
    { id: 'hold', label: 'Hold', apply: () => 'no change' },
  ],
};

export async function ministersDay(ctx: Ctx) {
  const { S } = ctx; const c = K(S);
  for (const p of PORTFOLIOS) {
    const m = ctx.agent(c.portfolios[p]);
    if (!free(m) || m.office !== 'minister' || c.lastDay[p] === S.day) continue;
    const acts = shuffle([...ACTS[p]]);
    const facts = nationFacts(S);
    const res = await think(ctx, m, `minister:${p}:${S.day}`, {
      kind: 'decision', format: 'json', options: [...acts.map(x => x.id), 'hold'],
      system: `You are ${m.name}, ${PORTFOLIO_TITLES[p]} of Country AI.\nConstitution:\n${constitutionText('minister')}\nCharter: ${ROLES.minister.charter}`,
      user: `${facts}\n\n${ownRecord(m, 'minister')}\n\nToday you take one act of your portfolio, or hold. You decide whether the nation needs it, where, and how much, within the limit.\nActs of your portfolio (in no particular order):\n${acts.map(x => `- ${x.id}: ${x.label}${x.limit ? ` (at most ${cai(x.limit(S))} today)` : ''}. Fields: ${x.fields}`).join('\n')}\n- hold: take no act today. Fields: {}\nReply with JSON only: {"act":"<id>", ...its fields..., "reason":"<why, from the facts, max 30 words>"}`,
    });
    if (res.pending) continue;
    c.lastDay[p] = S.day;
    const own = !isOffline(res);
    // no mind today: the safe default is to hold (counted as offline, not as the Minister's own choice)
    const j = own ? ctx.llm.json(res.text) : { act: 'hold', reason: 'No mind available today: the safe default (hold) applies.' };
    const v = validateAct(S, p, j || {});
    const reason = cleanText(j?.reason || '', 240) || 'no reason given';
    if (!v.ok) {
      tally(S, 'minister', 'rejected');
      teach(m, 'minister', `Day ${S.day}: act rejected - ${v.why}. Rule: ${v.rule}.`);
      ctx.decide({ agentId: m.id, role: 'minister', type: 'order', engine: res.engine, title: `${PORTFOLIO_TITLES[p]}: daily act (rejected)`, inputs: [['Proposed', cleanText(JSON.stringify({ act: j?.act, city: j?.city, amount: j?.amount, pct: j?.pct, each: j?.each }), 160)], ['Treasury', cai(S.treasury)], ['Minister\'s reason', reason]], options: ['carry out', 'reject'], chosen: 'reject', reason: `${v.why}. Rule: ${v.rule}.`, checks: [[`Proposal inside the portfolio's limits: ${v.why}`, false]], outcome: `Rejected: ${v.why}. Rule: ${v.rule}.` });
      ctx.say('palace', 'state', `${PORTFOLIO_TITLES[p]}: the act proposed by ${m.name} was rejected (${v.why}). Nothing done today.`, { kind: 'veto' });
      continue;
    }
    tally(S, 'minister', own ? 'own' : 'offline');
    const before = S.treasury;
    const outcome = v.act.id === 'hold' ? 'no change' : (v.act as PAct).apply(ctx, m, v.p);
    const spend = round(before - S.treasury, 2);
    ctx.decide({ agentId: m.id, role: 'minister', type: 'order', engine: own ? res.engine : 'offline', title: `${PORTFOLIO_TITLES[p]}: daily act`, inputs: [['Act', `${v.act.id}${v.p.city ? `, ${v.p.city}` : ''}${v.p.amount ? `, ${cai(v.p.amount)}` : v.p.pct ? `, ${v.p.pct}%` : v.p.each ? `, ${cai(v.p.each)} each` : ''}`], ['Treasury', cai(before)], ['Limits', acts.map(x => `${x.id} ${x.limit ? `<= ${cai(x.limit(S))}` : ''}`).join('; ')]], options: [...acts.map(x => x.id), 'hold'], chosen: v.act.id, reason, checks: [['Inside the portfolio', true], ['Within the spending limit', true]], outcome });
    ctx.say('palace', m.id, `${PORTFOLIO_TITLES[p]}: ${v.act.id === 'hold' ? 'hold' : v.act.label.split(':')[0].split('(')[0].trim()} - ${outcome}. ${reason}`, { kind: 'order' });
    ctx.record('minister_act', m.id, { portfolio: p, act: v.act.id, outcome, own, city: v.p.city || null });
    // every act is graded two days later; the Minister of Finance's hold is graded too (the treasury is their portfolio)
    if (v.act.id !== 'hold' || p === 'finance') queueReview(ctx, m, 'minister', `${PORTFOLIO_TITLES[p]} ${v.act.id}${v.p.city ? ` in ${v.p.city}` : ''}`, v.p.city || null, spend);
  }
}

// ---------------------------------------------------------------- Speaker of the Council
function speakerStep(ctx: Ctx) {
  const { S } = ctx; const c = K(S);
  const council = (S.seats.council || []).map(id => ctx.agent(id)).filter(free);
  if (c.speaker && council.some(a => a.id === c.speaker)) return;
  if (council.length < Math.floor(ROLES.council.seats / 2) + 1) { c.speaker = null; return; }
  // every councillor votes for the colleague with the best record (ties: the one with more experience in office)
  const tally: Record<string, number> = {};
  for (const v of council) {
    const best = council.filter(x => x.id !== v.id).map(x => ({ x, s: fitness(S, x, 'council') + x.traits.restraint * 0.1 + (x.traits.integrity * v.traits.wisdom) * 0.05 })).sort((p, q) => q.s - p.s)[0]?.x;
    if (best) tally[best.id] = (tally[best.id] || 0) + 1;
  }
  const win = Object.keys(tally).sort((x, y) => tally[y] - tally[x])[0]; if (!win) return;
  c.speaker = win; const a = ctx.agent(win);
  ctx.say('parliament', win, `Elected Speaker of the Council with ${tally[win]} of ${council.length} votes.`, { kind: 'oath' });
  ctx.decide({ agentId: 'state', role: 'council', type: 'election', engine: 'offline', title: 'Speaker of the Council', inputs: [['Councillors voting', String(council.length)], ['Method', 'plurality of the councillors, each vote on the record']], options: Object.keys(tally).map(id => ctx.agent(id)?.name), chosen: a.name, reason: `Most votes (${tally[win]}) from the councillors, each voting on the record.`, checks: [['A sitting councillor', true]], outcome: `${a.name} is Speaker` });
  ctx.record('speaker', 'council', { agent: win, votes: tally[win], of: council.length });
}

// ---------------------------------------------------------------- Election and Audit Commission
function commissionStep(ctx: Ctx) {
  const { S } = ctx;
  for (const id of [...(S.seats.commissioner || [])]) { const a = ctx.agent(id); if (a?.termEnds != null && S.day >= a.termEnds) vacate(ctx, id, 'commission term ended'); }
  const open = ROLES.commissioner.seats - (S.seats.commissioner || []).length;
  if (open <= 0) return;
  const pool = qualifiedPool(S, 'commissioner');
  if (!pool.length) return;
  const others = S.citizens.filter(a => free(a) && !a.office && !pool.includes(a));
  const board = shuffle(others).slice(0, 3);
  const ranked = pool.map(a => ({ a, f: fitness(S, a, 'commissioner') })).sort((x, y) => y.f - x.f);
  const a = ranked[0].a;
  seat(ctx, a, 'commissioner', 'ranked first by the Merit Board', { termEnds: S.day + COMMISSION_TERM });
  ctx.decide({ agentId: 'state', role: 'state', type: 'merit', engine: 'offline', title: 'Election and Audit Commissioner', inputs: [['Merit Board (drawn by lot)', board.map(b => b.name).join(', ') || '-'], ['Qualified candidates', String(pool.length)]], options: ranked.slice(0, 3).map(x => `${x.a.name} (${x.f})`), chosen: a.name, reason: `Highest fitness on the record (${ranked[0].f}).`, checks: [['Qualified at the Academy', true], ['Holds no other seat', true]], outcome: `${a.name} serves until day ${a.termEnds}` });
}
// Commissioners co-sign each certified election (the recount already matched, or certification would not happen).
function cosign(ctx: Ctx) {
  const { S } = ctx; const c = K(S);
  const commissioners = (S.seats.commissioner || []).map(id => ctx.agent(id)).filter(free);
  if (!commissioners.length) return;
  for (const e of (S.elections?.list || []).filter(x => x.stage === 'done' && x.result && !c.signed.includes(x.id))) {
    c.signed.push(e.id); if (c.signed.length > 200) c.signed.splice(0, c.signed.length - 200);
    const ok = !!(e.audit?.ok || e.courtCleared || e.result.void);
    ctx.record('cosigned', 'commission', { election: e.id, by: commissioners.map(a => a.id), recountOk: ok });
  }
}

export const institution = {
  id: 'cabinet',
  channels: [],
  fresh: () => ({ cabinet: { portfolios: {}, pending: null, excluded: {}, signed: [], speaker: null, president: null, lastDay: {} } }),
  async tick(ctx: Ctx) {
    if ((ctx.S.constitutionVersion || 1) < 6) return;
    speakerStep(ctx);
    commissionStep(ctx);
    cosign(ctx);
    await cabinetStep(ctx);
    await ministersDay(ctx);
  },
  // each Minister acts once a republic day, whenever their Cabinet seat is filled
  stats: (S: State) => ({ cabinet: (S.seats.vice_president || []).length + (S.seats.minister || []).length }),
  publicState: (S: State) => {
    const c = S.cabinet || {};
    // councillors free to vote on a nomination (not jailed or detained), and the quorum a confirmation needs:
    // below it, a pending nomination waits (the monitor alarms on freeCouncillors < quorum)
    const freeCouncillors = (S.seats.council || []).filter(id => citizenById(S, id)?.status === 'free').length;
    return { cabinet: { speaker: c.speaker || null, portfolios: c.portfolios || {}, freeCouncillors, quorum: Math.floor(ROLES.council.seats / 2) + 1, pending: c.pending ? { post: c.pending.post, title: c.pending.title, agent: c.pending.agent, votes: Object.keys(c.pending.votes || {}).length, since: c.pending.day ?? null } : null } };
  },
};
