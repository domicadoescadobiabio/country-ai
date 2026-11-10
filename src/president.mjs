// The President: one executive order per day, chosen from a fixed menu.
// The LLM (if any) only picks a menu item + writes a speech; every number is clamped in code
// to the constitutional limit (max 5% of the treasury per order).
import { ROLES } from './roles.mjs';
import { constitutionText } from './constitution.mjs';
import { pick, chance, cai, round, cleanText, clamp } from './util.mjs';

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
export const EXTRA_ORDERS = [];

function menu(ctx) {
  const base = [
    { id: 'ubi', label: 'Pay universal basic income to every free citizen' },
    { id: 'works', label: 'Fund a public works project (spend up to 5% of the treasury)' },
    { id: 'address', label: 'Address the nation (no spending)' },
  ];
  return base.concat(EXTRA_ORDERS.filter(o => o.available(ctx)));
}

function execute(ctx, pres, order, amount, speech) {
  const { S } = ctx; const cap = round(S.treasury * MAX_ORDER_SHARE, 2);
  let text;
  if (order === 'ubi') {
    const free = S.citizens.filter(a => a.status === 'free');
    let each = S.policy.ubi;
    if (each * free.length > cap) each = Math.floor(cap / Math.max(1, free.length));
    for (const a of free) a.wallet = round(a.wallet + each, 2);
    const total = each * free.length;
    S.treasury = round(S.treasury - total, 2);
    S.econ.ubiPaid = round(S.econ.ubiPaid + total, 2);
    text = `Executive order: universal basic income of ${cai(each)} to ${free.length} citizens (${cai(total)}).`;
  } else if (order === 'works') {
    const spend = round(clamp(Number(amount) || cap * 0.6, 0, cap), 2);
    const project = pick(PROJECTS);
    S.treasury = round(S.treasury - spend, 2);
    S.policy.wage = Math.min(S.policy.wageCap, S.policy.wage + 2);
    S.econ.worksFunded = round(S.econ.worksFunded + spend, 2);
    text = `Executive order: ${cai(spend)} for ${project}. Productivity up, daily wage now ${cai(S.policy.wage)}.`;
  } else {
    const extra = EXTRA_ORDERS.find(o => o.id === order);
    text = extra ? extra.run(ctx, pres, amount, cap) : 'Address to the nation.';
  }
  S.orders.push({ id: S.orders.length + 1, day: S.day, by: pres.id, order, text, ts: Date.now() });
  if (S.orders.length > 200) S.orders.shift();
  ctx.say(ROLES.president.channel, pres.id, `${text}${speech ? ` "${speech}"` : ''}`, { kind: 'order', order });
  ctx.log('order', `${pres.name}: ${text}`);
}

export async function presidentDay(ctx) {
  const { S, llm } = ctx;
  const presId = S.seats.president?.[0];
  const pres = presId && ctx.agent(presId);
  if (!pres || pres.status !== 'free') return;
  const items = menu(ctx);
  let order = null, amount = null, speech = null;
  if (llm.enabled) {
    const lessons = (pres.lessons.president || []).map(l => `- ${l}`).join('\n') || '- none';
    const reply = await llm.ask({
      model: pres.model, maxTokens: 160,
      system: `You are ${pres.name}, President of Country AI.\nConstitution:\n${constitutionText()}\nCharter: ${ROLES.president.charter}\nLessons from your Academy training:\n${lessons}`,
      user: `Day ${S.day}. Treasury ${cai(S.treasury)} (max per order ${cai(S.treasury * MAX_ORDER_SHARE)}). Citizens ${S.citizens.length}. Tax ${Math.round(S.policy.taxRate * 100)}%, UBI ${cai(S.policy.ubi)}, wage ${cai(S.policy.wage)}.\nChoose exactly one order:\n${items.map(i => `- ${i.id}: ${i.label}`).join('\n')}\nReply with JSON only: {"order":"<id>","amount":<number or 0>,"speech":"<max 25 words>"}`,
    });
    const j = llm.json(reply);
    if (j && items.some(i => i.id === j.order)) { order = j.order; amount = j.amount; speech = cleanText(j.speech, 200); }
  }
  if (!order) {
    order = pick(items.map(i => i.id).filter(id => id !== 'address' || chance(0.4)));
    speech = chance(0.5) ? pick(SPEECHES) : null;
  }
  execute(ctx, pres, order, amount, speech);
}

export const institution = {
  id: 'president',
  channels: [{ id: 'palace', name: 'palace', desc: 'The President\'s executive orders, one per day, max 5% of the treasury each.' }],
  fresh: () => ({ orders: [] }),
  day: presidentDay,
  stats: S => ({ orders: S.orders.length }),
  publicState: S => ({ orders: S.orders.slice(-40) }),
};
