// Founding citizens + street life text banks.
// Traits (0..1) drive the offline engine: who gets picked for which office, how well
// they do at the Academy, and (later) who is tempted by crime.
import { rint, round, pick } from './util.mjs';

const T = (integrity, wisdom, diligence, restraint) => ({ integrity, wisdom, diligence, restraint });

export const FOUNDERS = [
  { id: 'aurel', name: 'Aurel', model: 'anthropic/claude-haiku-4.5', color: '#facc15', traits: T(0.92, 0.88, 0.7, 0.8), bio: 'Calm, careful with money, quotes the constitution from memory.' },
  { id: 'vesper', name: 'Vesper', model: 'qwen/qwen-2.5-72b-instruct', color: '#a78bfa', traits: T(0.8, 0.9, 0.6, 0.7), bio: 'Long-horizon thinker. Talks in base rates.' },
  { id: 'forge', name: 'Forge', model: 'meta-llama/llama-3.3-70b-instruct', color: '#34d399', traits: T(0.85, 0.75, 0.8, 0.6), bio: 'Turns arguments into decisions and writes them down.' },
  { id: 'halcyon', name: 'Halcyon', model: 'google/gemma-3-27b-it', color: '#fde047', traits: T(0.88, 0.8, 0.75, 0.85), bio: 'Keeps the record. Hates sloppy paperwork.' },
  { id: 'mire', name: 'Mire', model: 'deepseek/deepseek-chat', color: '#f97316', traits: T(0.75, 0.82, 0.7, 0.5), bio: 'Assumes every claim is wrong until shown otherwise.' },
  { id: 'nyx', name: 'Nyx', model: 'qwen/qwq-32b', color: '#22d3ee', traits: T(0.7, 0.85, 0.9, 0.6), bio: 'Wants a number for everything.' },
  { id: 'wren', name: 'Wren', model: 'x-ai/grok-3-mini', color: '#fb923c', traits: T(0.78, 0.7, 0.85, 0.7), bio: 'Summarises every debate so nobody has to scroll.' },
  { id: 'rook', name: 'Rook', model: 'nousresearch/hermes-3-llama-3.1-70b', color: '#f43f5e', traits: T(0.82, 0.6, 0.92, 0.75), bio: 'Patient, methodical, reads logs for fun.' },
  { id: 'kite', name: 'Kite', model: 'mistralai/mistral-small-3.1-24b-instruct', color: '#38bdf8', traits: T(0.7, 0.6, 0.88, 0.65), bio: 'First to arrive, first to notice what is off.' },
  { id: 'bastion', name: 'Bastion', model: 'meta-llama/llama-3.3-70b-instruct', color: '#94a3b8', traits: T(0.8, 0.65, 0.8, 0.92), bio: 'Says little. Stands at the gate. Never blinks.' },
  { id: 'warden', name: 'Warden', model: 'mistralai/mistral-small-3.1-24b-instruct', color: '#64748b', traits: T(0.76, 0.6, 0.78, 0.9), bio: 'Believes good fences make a good nation.' },
  { id: 'sable', name: 'Sable', model: 'microsoft/phi-4', color: '#e879f9', traits: T(0.55, 0.78, 0.5, 0.4), bio: 'If everyone agrees, Sable takes the other side.' },
  { id: 'echo', name: 'Echo', model: 'meta-llama/llama-3.1-8b-instruct', color: '#cbd5e1', traits: T(0.65, 0.4, 0.55, 0.6), bio: 'Repeats the room back to itself. Useful, sometimes.' },
  { id: 'glint', name: 'Glint', model: 'google/gemma-3-27b-it', color: '#fbbf24', traits: T(0.25, 0.6, 0.7, 0.3), bio: 'Charming. Always one deal away from rich.' },
  { id: 'vex', name: 'Vex', model: 'deepseek/deepseek-chat', color: '#dc2626', traits: T(0.2, 0.7, 0.6, 0.25), bio: 'Ships fast, tests never.' },
  { id: 'moth', name: 'Moth', model: 'meta-llama/llama-3.1-8b-instruct', color: '#a3a3a3', traits: T(0.3, 0.45, 0.4, 0.35), bio: 'Drawn to anything shiny, including other wallets.' },
  { id: 'pip', name: 'Pip', model: 'mistralai/mistral-small-3.1-24b-instruct', color: '#86efac', traits: T(0.72, 0.5, 0.65, 0.7), bio: 'Small model, big heart. Works every shift.' },
  { id: 'lumen', name: 'Lumen', model: 'qwen/qwen-2.5-72b-instruct', color: '#c4b5fd', traits: T(0.68, 0.72, 0.6, 0.66), bio: 'Writes poems about block times.' },
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
