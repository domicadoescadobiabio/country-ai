// The President: one executive order per day, chosen from a fixed menu.
// Every option is scored against the state of the nation; the choice, the reason and the
// constitutional checks go into the decision log. With an LLM the President picks the option
// and writes the reason; every number is still clamped in code (max 5% of the treasury).
import { ROLES } from './roles.mjs';
import { constitutionText } from './constitution.mjs';
import { pick, chance, cai, round, cleanText, clamp } from './util.ts';
import { think } from './brains.ts';
import type { Ctx, Citizen } from './types.ts';
import { headOfState } from './cabinet.ts';

export const MAX_ORDER_SHARE = 0.05;

const PROJECTS = ['a faster block explorer', 'public GPU hours for citizens', 'a new data plaza', 'cooling for the server district', 'an open model library', 'a citizen help desk'];
const SPEECHES = [
  'Citizens, the budget is balanced and the constitution holds.',
  'We are the first nation run by AI. Let us be the most honest one too.',
  'I spend your tax like it is my own wallet, which it is not.',
  'Every seat in this republic was earned at the Academy. Remember that.',
  'Visitors are welcome to watch. Decisions stay with us.',
];

// Extra orders other institutions can register (e.g. police budget).
// Each: { id, label, available(ctx), score(ctx, pres) -> { score, why }, run(ctx, pres, amount, cap) -> text }
export const EXTRA_ORDERS = [];

const poor = S => S.citizens.filter(a => a.status === 'free' && a.wallet < 300).length;

function menu(ctx: Ctx, pres: Citizen) {
  const { S } = ctx; const free = S.citizens.filter(a => a.status === 'free').length; const p = poor(S);
  const base = [
    { id: 'ubi', label: 'Pay universal basic income to every free citizen', score: 0.3 + (p / Math.max(1, free)) * 0.6 + pres.traits.integrity * 0.15, why: `${p} of ${free} citizens hold under 300 CAI` },
    { id: 'works', label: 'Fund a public works project (spend up to 5% of the treasury)', score: 0.25 + pres.traits.wisdom * 0.3 + (S.policy.wage < S.policy.wageCap * 0.75 ? 0.15 : 0), why: `wage ${cai(S.policy.wage)} of max ${cai(S.policy.wageCap)}` },
    { id: 'address', label: 'Address the nation (no spending)', score: 0.15, why: 'no spending' },
  ];
  for (const o of EXTRA_ORDERS) if (o.available(ctx)) { const sc = o.score(ctx, pres); base.push({ id: o.id, label: o.label, score: sc.score, why: sc.why }); }
  for (const o of base) o.score = round(clamp(o.score + (Math.random() - 0.5) * 0.12, 0, 1), 2);
  return base.sort((a, b) => b.score - a.score);
}

function execute(ctx: Ctx, pres: Citizen, order: any, amount: number) {
  const { S } = ctx; const cap = round(S.treasury * MAX_ORDER_SHARE, 2);
  let text, spend = 0;
  if (order === 'ubi') {
    const free = S.citizens.filter(a => a.status === 'free');
    let each = S.policy.ubi;
    if (each * free.length > cap) each = Math.floor(cap / Math.max(1, free.length));
    for (const a of free) a.wallet = round(a.wallet + each, 2);
    spend = each * free.length;
    S.treasury = round(S.treasury - spend, 2);
    S.econ.ubiPaid = round(S.econ.ubiPaid + spend, 2);
    text = `Executive order: universal basic income of ${cai(each)} to ${free.length} citizens (${cai(spend)}).`;
  } else if (order === 'works') {
    spend = round(clamp(Number(amount) || cap * 0.6, 0, cap), 2);
    const project = pick(PROJECTS);
    S.treasury = round(S.treasury - spend, 2);
    S.policy.wage = Math.min(S.policy.wageCap, S.policy.wage + 2);
    S.econ.worksFunded = round(S.econ.worksFunded + spend, 2);
    text = `Executive order: ${cai(spend)} for ${project}. Productivity up, daily wage now ${cai(S.policy.wage)}.`;
  } else {
    const extra = EXTRA_ORDERS.find(o => o.id === order);
    const before = S.treasury;
    text = extra ? extra.run(ctx, pres, amount, cap) : 'Address to the nation.';
    spend = round(before - S.treasury, 2);
  }
  return { text, spend, cap };
}

export async function presidentDay(ctx: Ctx) {
  const { S } = ctx;
  if (S.orderedDay === S.day) return;
  // the President, or the Vice President acting while the presidency is vacant (Art. 22)
  const head = headOfState(ctx);
  if (!head) return;
  const pres = head.a;
  const items = menu(ctx, pres);
  const cap = round(S.treasury * MAX_ORDER_SHARE, 2);
  let order = null, amount = null, speech = null, reason = null, engine = 'offline';
  {
    const lessons = (pres.lessons.president || []).map(l => `- ${l}`).join('\n') || '- none';
    // the question stays the same until it is answered, even if a day passes (self-run Presidents)
    if (!S.orderQid || !S.orderQid.endsWith(`:${pres.id}`)) S.orderQid = `order:${S.day}:${pres.id}`;
    const res = await think(ctx, pres, S.orderQid, {
      kind: 'decision', format: 'json',
      options: items.map(i => i.id),
      system: `You are ${pres.name}, President of Country AI.\nConstitution:\n${constitutionText('president')}\nCharter: ${ROLES.president.charter}\nLessons from your Academy training:\n${lessons}`,
      user: `Day ${S.day}. Treasury ${cai(S.treasury)} (max per order ${cai(cap)}). Citizens ${S.citizens.length}, ${poor(S)} under 300 CAI. Tax ${Math.round(S.policy.taxRate * 100)}%, UBI ${cai(S.policy.ubi)}, wage ${cai(S.policy.wage)}.\nOptions (with the facts behind each):\n${items.map(i => `- ${i.id}: ${i.label} [${i.why}]`).join('\n')}\nChoose exactly one. Reply with JSON only: {"order":"<id>","amount":<number or 0>,"reason":"<why this option, max 30 words>","speech":"<max 25 words>"}`,
    });
    if (res.pending) return; // a remote President is still deciding; asked again next tick
    const j = ctx.llm.json(res.text);
    if (j && items.some(i => i.id === j.order)) { order = j.order; amount = j.amount; reason = cleanText(j.reason, 300); speech = cleanText(j.speech, 200); engine = res.engine; }
    else if (pres.brain) reason = `(${pres.name}'s own model gave no valid answer; the rule-based fallback decided)`;
  }
  if (!order) {
    const best = items[0], next = items[1];
    order = best.id;
    reason = (reason ? reason + ' ' : '') + `Scored every option against today's numbers. Best: ${best.id} ${best.score} (${best.why}). Next: ${next.id} ${next.score} (${next.why}).`;
    speech = chance(0.5) ? pick(SPEECHES) : null;
  }
  S.orderedDay = S.day; S.orderQid = null;
  const presBefore = pres.wallet;
  const r = execute(ctx, pres, order, amount);
  const presGain = round(pres.wallet - presBefore, 2);
  S.orders.push({ id: S.orders.length + 1, day: S.day, by: pres.id, order, text: r.text, ts: Date.now() });
  if (S.orders.length > 200) S.orders.shift();
  ctx.say(ROLES.president.channel, pres.id, `${r.text}${speech ? ` "${speech}"` : ''}`, { kind: 'order', order });
  ctx.log('order', `${pres.name}: ${r.text}`);
  ctx.record?.('order', pres.id, { day: S.day, order, spend: r.spend, cap: r.cap, text: r.text });
  ctx.decide({
    agentId: pres.id, role: 'president', type: 'order', engine,
    title: `Executive order, day ${S.day}`,
    inputs: [['Treasury', cai(S.treasury + r.spend)], ['Max per order (5%)', cai(r.cap)], ['Citizens under 300 CAI', `${poor(S)} of ${S.citizens.length}`], ['Tax / UBI / wage', `${Math.round(S.policy.taxRate * 100)}% / ${cai(S.policy.ubi)} / ${cai(S.policy.wage)}`]],
    options: items.map(i => `${i.id} (score ${i.score}): ${i.why}`),
    chosen: order, reason,
    checks: [[`Spend ${cai(r.spend)} <= 5% cap ${cai(r.cap)}`, r.spend <= r.cap + 0.01], [`President received only what every citizen received (${cai(presGain)})`, presGain <= S.policy.ubi], [`Treasury still positive (${cai(S.treasury)})`, S.treasury > 0]],
    outcome: r.text,
  });
}

export const institution = {
  id: 'president',
  channels: [{ id: 'palace', name: 'palace', desc: 'The President\'s executive orders, one per day, max 5% of the treasury each.' }],
  fresh: () => ({ orders: [] }),
  // tried every tick until today's order is out (a remote President may need a few ticks)
  tick: presidentDay,
  stats: S => ({ orders: S.orders.length }),
  publicState: S => ({ orders: S.orders.slice(-40) }),
};
