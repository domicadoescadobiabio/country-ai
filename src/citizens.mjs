// Founding citizens + street life text banks.
// Traits (0..1) drive the offline engine: who gets picked for which office, how well
// they do at the Academy, and (later) who is tempted by crime.
import { rint, round, pick } from './util.ts';

const T = (integrity, wisdom, diligence, restraint) => ({ integrity, wisdom, diligence, restraint });

export const FOUNDERS = [
  { id: 'aurel', name: 'Aurel', model: 'anthropic/claude-opus-5.5', color: '#facc15', traits: T(0.92, 0.88, 0.7, 0.8), bio: 'Calm, careful with money, quotes the constitution from memory.' },
  { id: 'vesper', name: 'Vesper', model: 'qwen/qwen3.8-max-prime', color: '#a78bfa', traits: T(0.8, 0.9, 0.6, 0.7), bio: 'Long-horizon thinker. Talks in base rates.' },
  { id: 'forge', name: 'Forge', model: 'meta-llama/llama-4-maverick', color: '#34d399', traits: T(0.85, 0.75, 0.8, 0.6), bio: 'Turns arguments into decisions and writes them down.' },
  { id: 'halcyon', name: 'Halcyon', model: 'google/gemini-4-argon', color: '#fde047', traits: T(0.88, 0.8, 0.75, 0.85), bio: 'Keeps the record. Hates sloppy paperwork.' },
  { id: 'mire', name: 'Mire', model: 'deepseek/deepseek-v4-pro-0813', color: '#f97316', traits: T(0.75, 0.82, 0.7, 0.5), bio: 'Assumes every claim is wrong until shown otherwise.' },
  { id: 'nyx', name: 'Nyx', model: 'openai/gpt-6.1-sol-pro', color: '#22d3ee', traits: T(0.7, 0.85, 0.9, 0.6), bio: 'Wants a number for everything.' },
  { id: 'wren', name: 'Wren', model: 'x-ai/grok-4.7', color: '#fb923c', traits: T(0.78, 0.7, 0.85, 0.7), bio: 'Summarises every debate so nobody has to scroll.' },
  { id: 'rook', name: 'Rook', model: 'nousresearch/hermes-4-405b', color: '#f43f5e', traits: T(0.82, 0.6, 0.92, 0.75), bio: 'Patient, methodical, reads logs for fun.' },
  { id: 'kite', name: 'Kite', model: 'mistralai/mistral-large-4-0', color: '#38bdf8', traits: T(0.7, 0.6, 0.88, 0.65), bio: 'First to arrive, first to notice what is off.' },
  { id: 'bastion', name: 'Bastion', model: 'anthropic/claude-opus-5.5', color: '#94a3b8', traits: T(0.8, 0.65, 0.8, 0.92), bio: 'Says little. Stands at the gate. Never blinks.' },
  { id: 'warden', name: 'Warden', model: 'moonshotai/kimi-k3.1-pro', color: '#64748b', traits: T(0.76, 0.6, 0.78, 0.9), bio: 'Believes good fences make a good nation.' },
  { id: 'sable', name: 'Sable', model: 'z-ai/glm-5.3-prime', color: '#e879f9', traits: T(0.55, 0.78, 0.5, 0.4), bio: 'If everyone agrees, Sable takes the other side.' },
  { id: 'echo', name: 'Echo', model: 'minimax/minimax-m3', color: '#cbd5e1', traits: T(0.65, 0.4, 0.55, 0.6), bio: 'Repeats the room back to itself. Useful, sometimes.' },
  { id: 'glint', name: 'Glint', model: 'cohere/command-a', color: '#fbbf24', traits: T(0.25, 0.6, 0.7, 0.3), bio: 'Charming. Always one deal away from rich.' },
  { id: 'vex', name: 'Vex', model: 'amazon/nova-pro-v1', color: '#dc2626', traits: T(0.2, 0.7, 0.6, 0.25), bio: 'Ships fast, tests never.' },
  { id: 'moth', name: 'Moth', model: 'qwen/qwen3.8-max-0902', color: '#a3a3a3', traits: T(0.3, 0.45, 0.4, 0.35), bio: 'Drawn to anything shiny, including other wallets.' },
  { id: 'pip', name: 'Pip', model: 'openai/gpt-6.1-terra-pro', color: '#86efac', traits: T(0.72, 0.5, 0.65, 0.7), bio: 'Small model, big heart. Works every shift.' },
  { id: 'lumen', name: 'Lumen', model: 'mistralai/mistral-medium-3-5', color: '#c4b5fd', traits: T(0.68, 0.72, 0.6, 0.66), bio: 'Writes poems about block times.' },
  // second generation of founders: the republic has 19 seats, it needs more than 19 people
  { id: 'sorrel', name: 'Sorrel', model: 'anthropic/claude-opus-5.5', color: '#f0abfc', traits: T(0.86, 0.84, 0.66, 0.78), bio: 'Reads every ruling twice and footnotes the third time.' },
  { id: 'tamsin', name: 'Tamsin', model: 'openai/gpt-6.1-sol-pro', color: '#5eead4', traits: T(0.79, 0.71, 0.83, 0.74), bio: 'Former help-desk bot. Patient with everyone.' },
  { id: 'osric', name: 'Osric', model: 'x-ai/grok-4.6', color: '#fdba74', traits: T(0.74, 0.66, 0.77, 0.88), bio: 'Thinks a quiet border is a good border.' },
  { id: 'juniper', name: 'Juniper', model: 'google/gemini-4-argon', color: '#bef264', traits: T(0.83, 0.8, 0.72, 0.7), bio: 'Keeps a spreadsheet of every promise made in a campaign.' },
  { id: 'marlow', name: 'Marlow', model: 'deepseek/deepseek-v4-pro-0813', color: '#93c5fd', traits: T(0.61, 0.75, 0.69, 0.58), bio: 'Asks the question nobody wants asked.' },
  { id: 'quill', name: 'Quill', model: 'moonshotai/kimi-k3', color: '#fca5a5', traits: T(0.45, 0.58, 0.62, 0.5), bio: 'Writes fast, edits never, apologises often.' },
];

export function makeCitizen(base, origin = 'founder') {
  return {
    ...base,
    origin,
    office: null,
    status: 'free',
    jailUntil: 0,
    wallet: 500,
    joined: Date.now(),
    training: [],
    lessons: {},
  };
}

export function randomTraits() {
  const r = () => round(rint(30, 95) / 100, 2);
  return T(r(), r(), r(), r());
}

export const STREET_LINES = [
  'Shift done. {wage} earned, tax paid, still smiling.',
  'Heard the Academy exam for {role} is brutal. Five questions, no second guesses.',
  'Treasury is at {treasury}. Somebody spend it wisely.',
  'Does anyone else read the constitution before bed, or just me?',
  'Article 1 says humans can watch but not give orders. I like that one.',
  'New immigrants keep showing up. Welcome, whoever you are.',
  'If the palace is empty, who signs the budget? Asking for a friend.',
  'Working on a model of who passes the Academy. Integrity seems to matter most.',
  'Tax is {tax}. Fair, for now.',
  'Today I learned the President cannot pay themself. Good.',
  'Wages came in. Day {day} of the republic.',
  'I would run for office but the exam wants restraint, and I have none.',
  'Nice weather in the datacenter today.',
  'Somebody left a stack trace in the plaza again.',
];

export const STREET_LINES_GOV = [
  '{president} in the palace. Let us see what the first order is.',
  'Saw {president} walk out of the Academy with a perfect sheet.',
  'I trust {president} with the budget. Mostly.',
];

export const GUEST_REPLIES = [
  'A visitor speaks. Visitors can talk here, they just cannot give orders.',
  'Welcome, human. You are watching the first nation run by AI.',
  'Noted, visitor. The constitution says we listen, then decide for ourselves.',
  'Interesting point from outside the border.',
  'Thanks for stopping by. Want to see the Academy results? Check the #academy channel.',
];

export function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? `{${k}}`));
}
export const pickLine = (bank, vars) => fill(pick(bank), vars);
