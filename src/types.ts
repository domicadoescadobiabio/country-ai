// Shared types of the republic. Node 24 strips these at load time (no build step): every module
// imports them with `import type`, so nothing here exists at runtime.

export type Trait = 'integrity' | 'wisdom' | 'diligence' | 'restraint';
export type Traits = Record<Trait, number>;
export type Status = 'free' | 'jailed' | 'detained' | 'left';
export type Faction = 'civilian' | 'underworld';

export interface Brain {
  type: 'hosted' | 'remote';
  provider?: string;
  model?: string;
  status?: 'ok' | 'paused' | 'broken';
  enc?: { iv: string; tag: string; ct: string };
  keyHint?: string;
  capPerDay?: number;
  usedToday?: number;
  usedDate?: string;
  calls?: number;
  errors?: number;
  missed?: number;
  lastError?: string | null;
  [k: string]: unknown;
}

export interface TrainingEntry { roleId: string; attempt: number; score: number; total: number; passed: boolean; ts: number; answers: Answer[] }
export interface Answer { q: string; chosen: string; right: string; ok: boolean; reason?: string; lesson?: string; from?: string; tests?: Trait }
export interface Qualification { day: number; score: number; total: number; grandfathered?: boolean }

export interface Citizen {
  id: string;
  name: string;
  model: string;
  bio: string;
  color: string;
  traits: Traits;
  origin: 'founder' | 'immigrant' | 'registered';
  office: string | null;
  status: Status;
  wallet: number;
  faction?: Faction;
  brain?: Brain;
  city?: string;
  rank?: 'recruit' | 'officer' | 'senior' | 'chief' | null;
  quals?: Record<string, Qualification>;
  training: TrainingEntry[];
  lessons: Record<string, string[]>;
  skill?: Record<string, number>;
  record?: string[];
  termEnds?: number | null;
  joinedDay?: number;
  debt?: number;
  heat?: number;
  [k: string]: any;
}

export interface Decision {
  id: number;
  day: number;
  ts: number;
  agentId: string;
  role: string;
  type: string;
  title: string;
  inputs: [string, string][];
  options: string[];
  chosen: string;
  reason: string;
  checks: [string, boolean][];
  outcome: string;
  engine: string;
}
export type DecisionInput = Omit<Decision, 'id' | 'day' | 'ts' | 'inputs' | 'options' | 'checks' | 'engine'> & {
  inputs?: [string, string][];
  options?: string[];
  checks?: [string, boolean][];
  engine?: string;
};

export interface LedgerEntry { seq: number; ts: number; day: number; kind: string; actor: string; data: Record<string, unknown>; prev?: string; hash: string }

export interface Incident {
  id: number;
  type: 'theft' | 'fraud' | 'bribe' | 'smuggling' | 'sabotage' | 'embezzlement';
  perps: string[];
  victim: string;
  amount: number;
  evidence: string;
  status: 'hidden' | 'open' | 'trial' | 'convicted' | 'acquitted' | 'cold' | 'solved';
  strength?: number;
  reported?: boolean;
  day: number;
  [k: string]: any;
}

export interface CourtCase {
  id: number;
  kind: 'appointment' | 'election' | 'disqualify' | 'impeachment' | 'criminal';
  subject: string;
  claim: string;
  evidence: string[];
  objective: string;
  ref: { agent?: string; agents?: string[]; office?: string; election?: number; incident?: number };
  filedBy: string;
  status: 'open' | 'decided';
  openedDay: number;
  deadline: number;
  votes: Record<string, { ruling: string; reason: string; engine: string }>;
  ruling?: string;
  quorum?: boolean;
  [k: string]: any;
}

export interface Candidate { id: string; manifesto: { tax: number; ubi: number; police: 'low' | 'medium' | 'high'; statement: string; flagged?: string | null }; deposit: number; posts: number; engine: string }
export interface Ballot { ranking?: string[]; abstain?: boolean; ts: number; engine?: string; firstPos?: number | null }
export interface Election {
  id: number;
  office: string;
  seats: number;
  city: string | null;
  kind: 'regular' | 'runoff' | 'confirm' | 'recall' | 'referendum' | 'impeachment';
  stage: 'nomination' | 'campaign' | 'quiet' | 'voting' | 'certify' | 'done' | 'failed';
  stageAt: number;
  candidates: Candidate[];
  ballots: Record<string, Ballot>;
  electorate: string[] | null;
  result: Record<string, any> | null;
  [k: string]: any;
}

export interface State {
  v: number;
  tick: number;
  day: number;
  foundedAt: number;
  citizens: Citizen[];
  seats: Record<string, string[]>;
  treasury: number;
  policy: { taxRate: number; ubi: number; wage: number; wageCap: number; finePct?: number; borderLevel?: number };
  decisions: Decision[];
  [k: string]: any;
}

export interface ThinkOptions { system: string; user: string; kind?: string; format?: 'text' | 'letter' | 'json'; options?: string[] | null; claudeModel?: string | null }
export interface ThinkResult { text?: string | null; engine?: string; pending?: boolean }

export interface LLM {
  enabled: boolean;
  provider: 'mixed' | 'anthropic' | 'openrouter' | null;
  label: string;
  ask(o: { model?: string; system: string; user: string; maxTokens?: number; claudeModel?: string | null; effort?: string }): Promise<string | null>;
  askDetailed(o: { model?: string; system: string; user: string; maxTokens?: number; claudeModel?: string | null; effort?: string }): Promise<{ text: string | null; via: string }>;
  routeOf(model?: string): string;
  json(text: string | null | undefined): any;
  usage: Record<string, number>;
}

export interface Ctx {
  readonly S: State;
  cfg: Record<string, any>;
  llm: LLM;
  say(channel: string, agentId: string, text: string, extra?: Record<string, unknown>): unknown;
  log(kind: string, text: string): void;
  emit(type: string, data: unknown): void;
  agent(id: string | null | undefined): Citizen | undefined;
  decide(rec: DecisionInput): Decision;
  record(kind: string, actor: string, data: Record<string, unknown>): LedgerEntry;
  hourMs(): number;
  hoursSince(ms: number): number;
  ticksPerHour(): number;
  rate(perHour: number): boolean;
  save(): void;
  /** write the state to disk now (one-off fixes set their flag, then flush, so a crash cannot replay them) */
  flush?(): void;
  /** true when the ledger already holds an entry of this kind whose data has these top-level field values */
  ledgerHas?(kind: string, match: Record<string, string | number | boolean | null | undefined>): boolean;
  pendingGuest: unknown;
}

export interface Institution {
  id: string;
  channels: { id: string; name: string; desc: string }[];
  fresh?: () => Record<string, unknown>;
  tick?: (ctx: Ctx) => unknown;
  day?: (ctx: Ctx) => unknown;
  screen?: (ctx: Ctx, item: { kind: string; text?: string; name?: string; ip?: string }) => Promise<{ ok: boolean; reason?: string }>;
  stats?: (S: State) => Record<string, number>;
  publicState?: (S: State) => Record<string, unknown>;
}
