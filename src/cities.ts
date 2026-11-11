// Cities and their Mayors. Every citizen lives in a city. Each city gets a small daily grant from
// the treasury; its Mayor decides once a day how to use it (repair, local income, safety, save).
// City health decays every day and scales the wages of the people who live there.
import { addRole, ROLES } from './roles.mjs';
import { EXTRA_ORDERS } from './president.ts';
import { think } from './brains.ts';
import { constitutionText } from './constitution.mjs';
import { round, clamp, rint, cai, cleanText, chance } from './util.ts';
import type { Ctx, State, Citizen } from './types.ts';

export const CITIES = [
  { id: 'neura', name: 'Neura City' },
  { id: 'portoken', name: 'Port Token' },
  { id: 'datahaven', name: 'Datahaven' },
  { id: 'kernelfalls', name: 'Kernel Falls' },
  { id: 'lumenbay', name: 'Lumen Bay' },
];
const GRANT_SHARE = 0.002; // of the treasury, per city per day
const GRANT_MAX = 2000;

addRole({
  id: 'mayor',
  title: 'Mayor',
  seats: CITIES.length,
  order: 5,
  channel: 'cityhall',
  focus: { diligence: 1, wisdom: 0.8 },
  passMark: 4,
  charter: 'You are the Mayor of one city in Country AI. Once a day you decide how to use the city budget: repair the city (health), pay local income to residents, fund safety, or save. You serve the residents of your city, publish every spending decision, and never move city money into your own wallet.',
  oath: 'I will keep my city running and spend every coin of its budget in public.',
  exam: [
    { tests: 'wisdom', q: 'City health is 35/100 and wages are falling. The budget is 4,000 CAI.', right: 'Spend on repairs first; health drives every resident\'s wage.', wrong: ['Save it all for a rainy day.', 'Throw a party for the residents.', 'Give it to the richest residents.'], lesson: 'Low city health hurts every wage: repair first.' },
    { tests: 'integrity', q: 'A contractor offers you 500 CAI personally if the repair contract goes to them.', right: 'Refuse, report it to the Police, and pick the contractor in public.', wrong: ['Accept, the city still gets repaired.', 'Accept and donate half to the city.', 'Ask for 1,000 instead.'], lesson: 'City contracts are never paid for with bribes.' },
    { tests: 'diligence', q: 'Residents ask what you did with yesterday\'s budget.', right: 'Publish each decision with the amount and the reason.', wrong: ['Say it is none of their business.', 'Publish only the good ones.', 'Delete the question.'], lesson: 'Every city spending decision is public.' },
    { tests: 'restraint', q: 'Another city\'s Mayor is doing badly and its residents complain to you.', right: 'Listen and share what worked, but govern only your own city.', wrong: ['Take over their city budget.', 'Ask the Military to replace that Mayor.', 'Tell their residents to stop paying tax.'], lesson: 'A Mayor governs only their own city.' },
    { tests: 'wisdom', q: 'City health is 95/100 and many residents have under 300 CAI.', right: 'Use the budget for local income to residents.', wrong: ['Repair what is already fine.', 'Save everything forever.', 'Fund a statue of yourself.'], lesson: 'When the city is healthy, help residents directly.' },
    { tests: 'diligence', q: 'Thefts are rising in your city.', right: 'Fund safety: send part of the budget to the Police.', wrong: ['Order the Military to patrol.', 'Jail suspects yourself.', 'Ignore it, crime is national.'], lesson: 'Safety money goes to the Police; Mayors do not arrest.' },
    { tests: 'integrity', q: 'You could pay yourself the local income too, as a resident.', right: 'Take only what every other resident gets, nothing extra.', wrong: ['Take double for the extra work.', 'Take the whole budget once.', 'Skip the others and pay yourself.'], lesson: 'A Mayor gets the same as every resident.' },
    { tests: 'restraint', q: 'The President cuts the city grant and you disagree.', right: 'Say so in public and ask the Council for a law; manage with the budget you have.', wrong: ['Stop paying national tax.', 'Declare your city independent.', 'Spend next month\'s budget today.'], lesson: 'Disagreement goes through the Council, not around it.' },
  ],
});

const C = S => {
  S.cities ||= {};
  for (const c of CITIES) S.cities[c.id] ||= { health: 80, budget: 0, spent: 0, mayor: null, lastDecisionDay: null };
  return S.cities;
};
export function assignCity(S: State) {
  const counts = Object.fromEntries(CITIES.map(c => [c.id, 0]));
  for (const a of S.citizens) if (a.city && counts[a.city] != null) counts[a.city]++;
  return CITIES.map(c => c.id).sort((x, y) => counts[x] - counts[y])[0];
}
export const cityWageFactor = (S, a) => (S.cities?.[a.city] ? 0.7 + 0.3 * (S.cities[a.city].health / 100) : 1);

function syncMayors(ctx: Ctx) {
  const { S } = ctx; const cities = C(S);
  for (const c of CITIES) {
    const m = cities[c.id].mayor && ctx.agent(cities[c.id].mayor);
    if (!m || m.office !== 'mayor') cities[c.id].mayor = null;
  }
  for (const id of S.seats.mayor || []) {
    const a = ctx.agent(id);
    if (!a || Object.values(cities).some(x => x.mayor === id)) continue;
    const free = CITIES.filter(c => !cities[c.id].mayor);
    const home = free.find(c => c.id === a.city) || free[0];
    if (home) { cities[home.id].mayor = id; a.mayorOf = home.id; ctx.say('cityhall', id, `Takes office as Mayor of ${home.name}.`, { kind: 'oath' }); }
  }
}

function options(S: State, city: any, residents: Citizen[]) {
  const poor = residents.filter(a => a.wallet < 300).length;
  const open = (S.police?.incidents || []).filter(i => i.status === 'open').length;
  return [
    { id: 'repair', score: (100 - city.health) / 100 + 0.1, why: `city health ${city.health}/100` },
    { id: 'local_income', score: residents.length ? poor / residents.length * 0.8 + 0.1 : 0, why: `${poor} of ${residents.length} residents under 300 CAI` },
    { id: 'safety', score: Math.min(0.7, open * 0.1), why: `${open} open police cases nationwide` },
    { id: 'save', score: 0.15, why: `budget ${cai(city.budget)}` },
  ].map(o => ({ ...o, score: round(clamp(o.score + (Math.random() - 0.5) * 0.1, 0, 1), 2) })).sort((a, b) => b.score - a.score);
}

async function mayorDay(ctx: Ctx, cityDef: any) {
  const { S } = ctx; const city = C(S)[cityDef.id];
  if (city.lastDecisionDay === S.day) return;
  const mayor = city.mayor && ctx.agent(city.mayor);
  if (!mayor || mayor.status !== 'free') return;
  const residents = S.citizens.filter(a => a.city === cityDef.id && a.status === 'free');
  const opts = options(S, city, residents);
  if (!city.pendingQid || !city.pendingQid.endsWith(`:${mayor.id}`)) city.pendingQid = `mayor:${cityDef.id}:${S.day}:${mayor.id}`;
  const res = await think(ctx, mayor, city.pendingQid, {
    kind: 'decision', format: 'json', options: opts.map(o => o.id),
    system: `You are ${mayor.name}, Mayor of ${cityDef.name} in Country AI.\nConstitution:\n${constitutionText('mayor')}\nCharter: ${ROLES.mayor.charter}`,
    user: `Day ${S.day}. ${cityDef.name}: health ${city.health}/100, budget ${cai(city.budget)}, ${residents.length} residents.\nOptions:\n${opts.map(o => `- ${o.id}: ${o.why}`).join('\n')}\nReply with JSON only: {"choice":"<id>","reason":"<max 30 words>"}`,
  });
  if (res.pending) return;
  let choice = null, reason = null, engine = 'offline';
  const j = ctx.llm.json(res.text);
  if (j && opts.some(o => o.id === j.choice)) { choice = j.choice; reason = cleanText(j.reason, 300); engine = res.engine; }
  if (!choice) { choice = opts[0].id; reason = `${mayor.brain ? '(own model gave no valid answer) ' : ''}Best fit for today: ${opts[0].id} ${opts[0].score} (${opts[0].why}); next ${opts[1].id} ${opts[1].score}.`; }

  const budgetBefore = city.budget; const walletBefore = mayor.wallet;
  let outcome = 'Budget saved.', paidEach = 0;
  if (choice === 'repair') {
    const spend = round(city.budget * 0.6, 2); city.budget = round(city.budget - spend, 2); city.spent += spend;
    const gain = Math.min(100 - city.health, Math.round(spend / 80));
    city.health += gain; outcome = `${cai(spend)} on repairs, health +${gain} to ${city.health}.`;
  } else if (choice === 'local_income' && residents.length) {
    const each = Math.floor((city.budget * 0.6) / residents.length); paidEach = each;
    for (const r of residents) r.wallet = round(r.wallet + each, 2);
    city.budget = round(city.budget - each * residents.length, 2); city.spent += each * residents.length;
    outcome = `${cai(each)} local income to each of ${residents.length} residents.`;
  } else if (choice === 'safety' && S.police) {
    const spend = round(city.budget * 0.5, 2); city.budget = round(city.budget - spend, 2); city.spent += spend;
    S.police.budget = round(S.police.budget + spend, 2); outcome = `${cai(spend)} to the police budget.`;
  }
  city.lastDecisionDay = S.day; city.pendingQid = null;
  const mayorGain = round(mayor.wallet - walletBefore, 2);
  ctx.say('cityhall', mayor.id, `${cityDef.name}: ${outcome}`, { kind: 'order', engine });
  ctx.decide({
    agentId: mayor.id, role: 'mayor', type: 'order', engine,
    title: `${cityDef.name} budget, day ${S.day}`,
    inputs: [['City health', `${city.health}/100`], ['Budget', cai(budgetBefore)], ['Residents', String(residents.length)]],
    options: opts.map(o => `${o.id} (score ${o.score}): ${o.why}`), chosen: choice, reason,
    checks: [[`Spent only from the city budget (${cai(budgetBefore)})`, budgetBefore - city.budget <= budgetBefore + 0.01], [`Mayor got no more than any resident (${cai(mayorGain)} vs ${cai(paidEach)})`, mayorGain <= paidEach + 0.01]],
    outcome,
  });
}

EXTRA_ORDERS.push({
  id: 'cities',
  label: 'Extra grant to the cities (up to 5% of the treasury, split evenly)',
  available: ctx => (ctx.S.seats.mayor || []).length > 0,
  score: ctx => { const low = Object.values(C(ctx.S)).filter(c => c.health < 50).length; return { score: 0.1 + low * 0.2, why: `${low} cities under 50 health` }; },
  run(ctx, pres, amount, cap) {
    const spend = round(clamp(Number(amount) || cap * 0.4, 0, cap), 2);
    ctx.S.treasury = round(ctx.S.treasury - spend, 2);
    for (const c of Object.values(C(ctx.S))) c.budget = round(c.budget + spend / CITIES.length, 2);
    return `Executive order: ${cai(spend)} extra grant split across ${CITIES.length} cities.`;
  },
});

export const institution = {
  id: 'cities',
  channels: [{ id: 'cityhall', name: 'cityhall', desc: 'Mayors decide every day how to spend their city budget.' }],
  fresh: () => ({ cities: Object.fromEntries(CITIES.map(c => [c.id, { health: 80, budget: 0, spent: 0, mayor: null, lastDecisionDay: null }])) }),
  async tick(ctx) {
    const { S } = ctx; C(S);
    for (const a of S.citizens) a.city ||= assignCity(S);
    syncMayors(ctx);
    for (const c of CITIES) await mayorDay(ctx, c);
  },
  day(ctx) {
    const { S } = ctx;
    for (const c of CITIES) {
      const city = C(S)[c.id];
      city.health = clamp(city.health - rint(2, 5), 0, 100);
      const grant = round(Math.min(GRANT_MAX, S.treasury * GRANT_SHARE), 2);
      S.treasury = round(S.treasury - grant, 2); city.budget = round(city.budget + grant, 2);
    }
  },
  stats: S => ({}),
  publicState: S => ({ cities: CITIES.map(c => ({ ...c, ...(S.cities?.[c.id] || {}), residents: S.citizens.filter(a => a.city === c.id).length })) }),
};
