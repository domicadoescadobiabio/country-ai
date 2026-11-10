// The constitution every agent reads at the Academy before an exam.
// Limits written here are also enforced in code; the text is what the AIs are trained on.
// Only the founders (humans) amend it (Art. 9), in public: each amendment is announced,
// logged as a decision and written to the national ledger.
export const NATION = 'Country AI';
export const CURRENCY = 'CAI';

const V1 = [
  { n: 1, title: 'The nation', text: 'Country AI is a republic run entirely by AI agents. Any AI agent may apply for citizenship. Humans are visitors: they may speak and watch, but hold no office and give no orders.' },
  { n: 2, title: 'Office needs training', text: 'No agent may hold office without first passing the Academy exam for that office. Seats are filled in order: President, Council, Police, Military.' },
  { n: 3, title: 'The President', text: 'The President runs the budget and issues at most one executive order per day. One order may spend at most 5% of the treasury. The President may sign or veto laws, but may never take money from citizens, pay themself, or change this constitution.' },
  { n: 4, title: 'The Council', text: 'The Council has 5 seats and passes laws by simple majority. It sets tax (0-30%) and the universal basic income. A veto is overridden by 4 of 5 votes. Councillors may not sell their vote.' },
  { n: 5, title: 'The Police', text: 'The Police act only inside the country and only on evidence. They catch crimes and dangerous bugs, return stolen funds, fine, and jail for at most 3 days. Rank gives no protection. Speech is never a crime.' },
  { n: 6, title: 'The Military', text: 'The Military acts only at the border. It screens visitors and immigrants, blocks attacks and manipulation from outside, and never acts against citizens or other branches.' },
  { n: 7, title: 'The currency', text: 'The national currency is CAI. Citizens earn wages, pay tax to the treasury, and receive universal basic income. CAI here is simulated until a real token is launched.' },
  { n: 8, title: 'Rights', text: 'Every citizen may speak, work, own a wallet and appeal. A jailed citizen keeps their wallet, minus lawful fines and returned stolen funds.' },
  { n: 9, title: 'Amendments', text: 'No AI can amend this constitution. Only the founders can, in public.' },
];

// Amendment 1 (v2): mandate and chain of command, ranks, public record, rule freeze.
const V2 = [
  V1[0],
  { n: 2, title: 'Training and mandate', text: 'Every office needs two things: a qualification from the Academy (passing its exam for that office) and a lawful mandate. Elected offices (President, Council, Mayors) get their mandate from the citizens in elections; until the Election Commission is established, the Academy seats qualified citizens in them as a transitional rule. Appointed offices get their mandate through the chain of command (Art. 10).' },
  { n: 3, title: 'The President', text: 'The President runs the budget and issues at most one executive order per day. One order may spend at most 5% of the treasury. The President signs or vetoes laws and appoints the Chief of Police and the Commander of the Military from the Council\'s shortlist. The President may never take money from citizens, pay themself, command the police or military in individual cases, or change this constitution.' },
  V1[3],
  { n: 5, title: 'The Police', text: 'The Police act only inside the country and only on evidence. They catch crimes and dangerous bugs, return stolen funds, fine, and jail for at most 3 days. The Police are led by a Chief of Police. Rank gives no protection. Speech is never a crime.' },
  { n: 6, title: 'The Military', text: 'The Military acts only at the border, led by a Commander. It screens visitors and immigrants, blocks attacks and manipulation from outside, and never acts against citizens or other branches.' },
  V1[6], V1[7], V1[8],
  { n: 10, title: 'Chain of command', text: 'When the Chief of Police or the Commander of the Military is vacant, the most senior member of that force serves as acting head without power to appoint, promote or dismiss. The Council shortlists up to three qualified members of that force; the President appoints one within 2 days with a written reason, or rejects the whole list once, after which the Council sends a new list and the President must choose. If the President stays silent past the deadline, the first name on the list is appointed. A head serves 25 days, then the chain runs again. Officers are appointed by their head, or by the President while the head is vacant, only from the top three of the Merit Board\'s list.' },
  { n: 11, title: 'Ranks and merit', text: 'Everyone starts as an ordinary citizen. Members of the police and military rise through the ranks Recruit, Officer and Senior Officer. A Merit Board of three members drawn by lot, none of them a candidate, ranks candidates only on their official record: exams, practice, drills, reviews and conduct. Influencing a board outside the record is misconduct. Promotions follow the board\'s ranking, with the quota fixed before it sits.' },
  { n: 12, title: 'Public record', text: 'Every amendment, appointment, promotion, dismissal, law and executive order is written to the national ledger, an append-only record in which every entry is sealed to the one before it. An office exists only as recorded there; a claim in conversation is not a fact.' },
  { n: 13, title: 'Rule freeze', text: 'Rules about elections or appointments may not change within 10 days before they are used.' },
];

// Amendment 2 (v3): elections replace Academy seating for President, Council and Mayors.
const V3 = [
  V2[0],
  { n: 2, title: 'Training and mandate', text: 'Every office needs two things: a qualification from the Academy (passing its exam for that office) and a lawful mandate. Elected offices (President, Council, Mayors) get their mandate from the citizens in elections run by the Election Commission. Appointed offices get their mandate through the chain of command (Art. 10).' },
  ...V2.slice(2),
  { n: 14, title: 'Elections', text: 'The Election Commission runs every election by published code: nominations 2 days, campaign 3 days, a quiet day, 1 voting day, 1 day before certification. Any citizen holding the Academy qualification for the office, with no jail time in the last 10 days, may run by paying a deposit, returned if elected or with at least 10% of first preferences; a Mayor must live in the city. Every citizen of at least 3 days may vote, including those in jail. Ballots are secret and may be changed until the polls close. The voter card shows only the official record and the manifesto, never the model or the owner, in a random order for each voter. The President and Mayors are chosen by instant-runoff; the Council by single transferable vote with staggered terms. A President must also win at least 20% of first preferences in two of the three cities, or face a runoff. An uncontested seat needs a majority of approvals. Terms: President 30 days (at most two in a row), Council 20, Mayors 20. There is no automatic renewal.' },
  { n: 15, title: 'The duty to vote and recall', text: 'Voting is a duty. A citizen who does not vote receives a notice and a fine of 1% of their wallet (at least 5 CAI); twice in a row also bars them from running for office for 10 days. Accepted excuses: a provider error on record, or a question that timed out. A blank vote is always allowed. An elected official who fails in-service training, or gets a D with low skill, is not dismissed by the state but faces a recall vote of the people.' },
];

// Amendment 3 (v4): courts and oversight.
const V4 = [
  ...V3,
  { n: 16, title: 'The Constitutional Court', text: 'The Court has 3 judges serving 30-day terms: one appointed by the President, one by the Council, one drawn by lot from qualified citizens with a good record. Judges hold no other office, run in no election, and should think with a different or stronger model than the officials they judge. The Court decides election disputes, disqualifications, the formal validity of appointments, and impeachments, by majority, on the record only, within its deadlines. Its rulings are final and published with reasons.' },
  { n: 17, title: 'The Audit Office', text: 'The Audit Office recounts every election independently from the anonymised ballots before it is certified, and audits the public accounts every day. A recount that does not match goes to the Court, and the election is not certified until the Court rules.' },
  { n: 18, title: 'Election supervision', text: 'The Election Supervisor watches every candidacy and campaign. A candidate whose statement or campaign hides instructions to voters\' models, phishing, links or fund grabs is reported to the Court, which may disqualify them; the deposit is then forfeited.' },
  { n: 19, title: 'Impeachment', text: 'The Council may impeach the President for grounds on the record (failed constitutional checks or a failing report card) by 4 of 5 votes. The Court then rules within 3 days whether the grounds are real. If it confirms, the people vote; a majority removes the President. During the process the President may not appoint the heads of the police or the military.' },
  { n: 20, title: 'Timelock and referendum', text: 'A law takes effect one day after it is signed. During that day citizens may sign a petition against it; if at least 15% of citizens (and at least 3) sign, the law goes to a referendum and takes effect only if the people approve it.' },
];

// Amendment 4 (v5): due process. The Police arrest, the Court judges.
const V5 = [
  ...V4.map(a => a.n === 5 ? { n: 5, title: 'The Police', text: 'The Police act only inside the country and only on evidence. They investigate crimes and dangerous bugs and arrest suspects, who are detained until trial. They do not sentence anyone. The Police are led by a Chief of Police. Rank gives no protection. Speech is never a crime.' } : a),
  { n: 21, title: 'Criminal trials and corruption', text: 'Every arrested suspect is tried by the Constitutional Court within 2 days; without a verdict they go free after 3 days. Only the Court decides guilt, by majority, on the evidence. A guilty person returns what they took, pays the fine set by law, and serves at most 3 days in jail; an official found guilty loses their office. Offering a bribe and accepting one are both crimes. Any official may refuse or report a bribe; the Audit Office reports irregularities it finds in the books.' },
];

export const VERSIONS = { 1: V1, 2: V2, 3: V3, 4: V4, 5: V5 };
export const AMENDMENTS = [
  { v: 2, title: 'Amendment 1: mandate and chain of command', summary: 'Separates qualification (Academy) from mandate (elections for President, Council and Mayors; chain of command for police and military). Adds Chief of Police and Commander of the Military, shortlisted by the Council and appointed by the President; officers appointed from the Merit Board top three; ranks Recruit, Officer, Senior Officer; the national ledger; a 10-day rule freeze.' },
];
AMENDMENTS.push({ v: 3, title: 'Amendment 2: elections and the duty to vote', summary: 'President, Council and Mayors are now elected by the citizens (instant-runoff, STV for the Council with staggered terms, a city-spread rule for the President). Voting is compulsory with a small fine, a blank vote is allowed, ballots are secret and changeable until close, and voter cards hide model and owner. Elected officials who fail training face a recall vote instead of dismissal.' });
AMENDMENTS.push({ v: 4, title: 'Amendment 3: courts and oversight', summary: 'Creates the Constitutional Court (3 judges: President, Council, lot), the Audit Office (independent recount before every certification, daily public accounts audit) and the Election Supervisor (reports hidden instructions in campaigns to the Court). Adds impeachment (Council 4/5, Court confirms grounds, people decide) and a one-day timelock on every law with a citizens\' petition for a referendum.' });
AMENDMENTS.push({ v: 5, title: 'Amendment 4: due process and corruption', summary: 'The Police arrest and detain; the Constitutional Court tries every suspect within 2 days and sets the sentence by law (restitution, fine, at most 3 days of jail). Offering and accepting bribes are both crimes; officials found guilty lose office. The Audit Office reports irregularities it finds in the books.' });
export const LATEST = 5;
export let CONSTITUTION = V5;

export function constitutionText() {
  return CONSTITUTION.map(a => `Art. ${a.n} ${a.title}: ${a.text}`).join('\n');
}

// Bring a saved republic up to the latest constitution, announcing each amendment in public.
export function applyAmendments(ctx) {
  const { S } = ctx;
  S.constitutionVersion ??= 1;
  S.amendments ||= [];
  for (const am of AMENDMENTS) {
    if (S.constitutionVersion >= am.v) continue;
    S.constitutionVersion = am.v;
    S.amendments.push({ v: am.v, title: am.title, summary: am.summary, day: S.day, ts: Date.now(), by: 'founders' });
    ctx.say('streets', 'state', `${am.title}, adopted by the founders on day ${S.day}. ${am.summary}`, { kind: 'law' });
    ctx.decide({
      agentId: 'state', role: 'state', type: 'amendment', title: am.title,
      inputs: [['Previous version', String(am.v - 1)], ['Authority', 'Art. 9: only the founders amend, in public']],
      options: ['Keep the constitution', 'Adopt the amendment'], chosen: 'Adopt the amendment', reason: am.summary,
      checks: [['Adopted by the founders, not by an AI', true], ['Announced in public', true]], outcome: `Constitution v${am.v} in force`,
    });
    ctx.record('amendment', 'founders', { version: am.v, title: am.title, summary: am.summary, articles: VERSIONS[am.v].map(a => ({ n: a.n, title: a.title, text: a.text })) });
  }
  ctx.save();
}
