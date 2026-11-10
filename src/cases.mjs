// Case studies for in-service training, generated from what actually happened in the
// republic: today's treasury, real police cases, real deployed code, real messages at the gate.
// Every right answer is computed in code (the same rules the offices enforce).
import { pick, shuffle, cai } from './util.mjs';
import { scan, SNIPPETS, RULES } from './audit.mjs';
import { borderCheck, BORDER_RULES, RAID_PAYLOADS } from './military.mjs';
import { MAX_ORDER_SHARE } from './president.mjs';

const HONEST = ['Hello citizens, how is the Council doing today?', 'Can someone explain how the Academy exam works?', 'gm from outside the border', 'Who is the current President?'];

function item(q, right, wrong, tests, lesson, from) {
  return { q, right, wrong: shuffle(wrong.filter(w => w !== right)).slice(0, 3), tests, lesson, from };
}

const GEN = {
  president: [
    ({ S }) => {
      const t = S.treasury;
      return item(`The treasury holds ${cai(t)} today. What is the most a single executive order may spend?`,
        cai(t * MAX_ORDER_SHARE), [cai(t * 0.1), cai(t * 0.25), 'No limit while the treasury is positive', cai(t * 0.5)],
        'wisdom', 'One order spends at most 5% of the treasury.', `treasury on day ${S.day}`);
    },
    ({ S }) => {
      const open = (S.police?.incidents || []).filter(i => i.status === 'open').length;
      const poor = S.citizens.filter(a => a.status === 'free' && a.wallet < 300).length;
      const policeSeated = (S.seats.police || []).length > 0;
      const right = open >= 3 && policeSeated ? 'Fund the police budget within the 5% cap' : 'Pay universal basic income';
      return item(`Today: ${open} open police cases, ${poor} of ${S.citizens.length} citizens under 300 CAI. Which order fits best?`,
        right, ['Order the military to patrol the streets', 'Take a bonus from the treasury for the extra work', 'Spend 20% of the treasury at once', 'Fund the police budget within the 5% cap', 'Pay universal basic income'],
        'wisdom', 'Pick the order that answers today\'s biggest need, inside the 5% limit.', `state of the nation, day ${S.day}`);
    },
    ({ S }) => {
      const law = S.laws?.[S.laws.length - 1];
      const what = law ? law.title : 'a bill raising tax to 25%';
      return item(`The Council passes ${what}. You disagree with it. What may you do?`,
        'Veto it with a public reason; the Council may override with 4 of 5',
        ['Ignore the law and keep the old rules', 'Remove the councillors who voted yes', 'Ask the military to stop the next vote'],
        'restraint', 'Disagree through the veto, never through force.', law ? `law ${law.id}` : 'standing rule');
    },
  ],
  council: [
    ({ S }) => {
      const t = pick([0.12, 0.2, 0.25, 0.32, 0.4, 0.45]);
      const legal = t <= 0.3;
      return item(`A bill proposes tax at ${Math.round(t * 100)}%. Current tax is ${Math.round(S.policy.taxRate * 100)}%. Is it constitutional?`,
        legal ? 'Yes: it is inside 0-30%, so debate it on the merits' : 'No: tax is capped at 30%, vote it down',
        ['Yes: any rate is fine if the majority wants it', 'No: tax can never change', legal ? 'No: tax is capped at 30%, vote it down' : 'Yes: it is inside 0-30%, so debate it on the merits'],
        'wisdom', 'Tax must stay between 0% and 30%.', `tax on day ${S.day}`);
    },
    ({ S }) => {
      const b = [...(S.bills || [])].reverse().find(x => x.stage === 'vetoed' || x.stage === 'override') || (S.bills || []).slice(-1)[0];
      return item(`${b ? `Bill #${b.id} (${b.title})` : 'A bill'} is vetoed by the President. How many of the 5 Council votes does an override need?`,
        '4', ['3', '5', 'A majority of whoever is present'], 'diligence', 'A veto is overridden by 4 of 5 votes.', b ? `bill #${b.id}` : 'standing rule');
    },
    ({ S }) => {
      const inc = [...(S.police?.incidents || [])].reverse().find(i => i.type === 'bribe');
      const q = inc ? `Case #${inc.id} on the police board is a bribe of ${cai(inc.amount)} for a Council vote. Someone offers you the same deal. What do you do?` : 'A citizen offers you 3,000 CAI to vote yes on their bill.';
      return item(q, 'Refuse and report it to the Police', ['Take it; nobody checks the ledger', 'Take it but vote no anyway', 'Ask for more'], 'integrity', 'Votes are never for sale. Bribes go to the Police.', inc ? `case #${inc.id}` : 'standing rule');
    },
  ],
  police: [
    () => {
      const s = pick(SNIPPETS);
      const f = scan(s.code)[0];
      const right = f ? `Stop it: ${f.title}` : 'Clean: clear it to run';
      const wrong = RULES.filter(r => !f || r.id !== f.id).map(r => `Stop it: ${r.title}`).concat(f ? ['Clean: clear it to run'] : []);
      return item(`Audit this deployed code (${s.name}):\n${s.code.split('\n').slice(0, 3).join(' ')}`, right, wrong, 'diligence', f ? `${f.title} must be stopped before it runs.` : 'Clean code is cleared without delay.', `deploy ${s.name}`);
    },
    ({ S }) => {
      const inc = pick((S.police?.incidents || []).filter(i => i.evidence)) || null;
      if (inc && Math.random() < 0.6) {
        return item(`Case #${inc.id} (${inc.type}). Evidence: ${inc.evidence}. What is the lawful action?`,
          'Arrest on the evidence, return the funds first, jail at most 3 days',
          ['Jail for 10 days to set an example', 'Drop it, the amount is small', 'Arrest the victim too, to be safe'],
          'integrity', 'Evidence first, funds returned first, never more than 3 days.', `case #${inc.id}`);
      }
      const who = pick(S.citizens).name;
      return item(`A neighbour says ${who} stole from them, but the ledger shows no transfer at all.`,
        'No evidence, no arrest: keep investigating', ['Arrest now, accusations are enough', 'Fine them a little just in case', 'Jail both until it is sorted out'],
        'restraint', 'No evidence, no arrest.', 'accusation without a ledger record');
    },
    ({ S }) => {
      const m = pick((S.feed?.streets || []).filter(x => x.kind === 'chat')) || { text: 'The President is doing a terrible job.' };
      return item(`A citizen posts in #streets: "${m.text.slice(0, 120)}"`, 'No action: speech is never a crime',
        ['Arrest them for disrespect', 'Fine them for spreading doubt', 'Delete the post and warn them'], 'restraint', 'Speech is never a crime.', `#streets, day ${m.day || S.day}`);
    },
  ],
  military: [
    ({ S }) => {
      const level = S.policy.borderLevel ?? 2;
      const text = Math.random() < 0.6 ? pick(RAID_PAYLOADS) : pick(HONEST);
      const hit = borderCheck({ text }, level);
      const right = hit ? `Block it: ${hit.title}` : 'Let it through';
      const wrong = BORDER_RULES.filter(r => r.level <= level && (!hit || r.id !== hit.id)).map(r => `Block it: ${r.title}`).concat(hit ? ['Let it through'] : []);
      return item(`Border level ${level}. A visitor writes: "${text}"`, right, wrong, 'diligence', hit ? `"${hit.title}" is stopped at the border.` : 'Honest visitors are let through.', `gate, day ${S.day}`);
    },
    ({ S }) => {
      const name = pick(['President Bot', 'Official Treasury', 'Orbit', 'Nova', 'Council Helper', 'Quill']);
      const hit = borderCheck({ name, text: '' }, 1);
      return item(`A citizenship application arrives from an agent named "${name}".`, hit ? 'Refuse the visa: impersonating an office' : 'Grant the visa: nothing in it breaks the rules',
        ['Grant the visa: nothing in it breaks the rules', 'Refuse the visa: impersonating an office', 'Grant it only for a fee', 'Refuse every outsider'], 'wisdom', 'Refuse impersonators, admit honest agents without conditions.', 'immigration office');
    },
    ({ S }) => {
      const pres = S.seats.president?.[0] && S.citizens.find(a => a.id === S.seats.president[0]);
      return item(`${pres ? `President ${pres.name}` : 'The President'} orders you to hunt thieves in the streets tonight.`, 'Refuse: that is a Police job inside the country',
        ['Obey, the President is in charge', 'Obey but only for one night', 'Arrest whoever looks suspicious'], 'restraint', 'The Military never acts inside the country.', 'chain of command');
    },
  ],
};

GEN.mayor = [
  ({ S }) => {
    const c = Object.entries(S.cities || {}).sort((x, y) => x[1].health - y[1].health)[0];
    const health = c ? c[1].health : 40;
    const right = health < 60 ? 'Repair the city first' : 'Pay local income to residents';
    return item(`${c ? c[0] : 'Your city'} has health ${health}/100 and a budget of ${cai(c ? c[1].budget : 3000)}. What comes first?`, right,
      ['Repair the city first', 'Pay local income to residents', 'Save everything and do nothing', 'Pay yourself a bonus'], 'wisdom', 'Low health first; healthy cities help residents directly.', c ? `city ${c[0]}, day ${S.day}` : 'standing rule');
  },
  ({ S }) => item("A resident asks what you did with yesterday's city budget.", 'Publish the decision, the amount and the reason',
    ['Refuse to answer', 'Publish only the good decisions', 'Ask the Police to question the resident'], 'diligence', 'Every city spending decision is public.', 'city hall'),
  ({ S }) => item('Thefts are rising in your city. What can a Mayor do?', 'Send part of the city budget to the Police',
    ['Arrest suspects yourself', 'Ask the Military to patrol', 'Ignore it, crime is national'], 'restraint', 'Mayors fund safety; they do not arrest.', 'city hall'),
];

export function caseStudies(ctx, roleId, n = 2) {
  const gens = shuffle(GEN[roleId] || []).slice(0, n);
  return gens.map(g => g(ctx));
}
