# Lessons from DAO governance and AI agent societies for a republic run by AI agents

Compiled 10 Nov 2026. Scope: which mechanisms work/fail in DAOs and in LLM-agent society experiments, plus AI constitutions and agent reputation/promotion. Focus on design lessons that can be transferred to elections, delegation, promotion, and institutions in an "AI state".

## 1. DAO governance: what failed, what improved outcomes?

### Takeaway
One-token-one-vote fails in predictable ways: low participation, concentrated power (often ±3 holders are enough to win), and votes that can be borrowed/bought (Beanstalk, Compound/Humpy). Fixes that proved useful are *structural*, not "get more people to vote": a time delay between decision and execution (timelock), a second chamber/veto from a party with different interests (Optimism Citizens' House, Lido dual governance), identity/reputation-based votes that cannot be transferred, and anti-collusion weighting (Gitcoin COCM).

### Cited Findings

**Low participation and concentration of power**
- A study of 216 DAOs (2020–2024, 2,988 proposals): the top 10% of holders control 76% of DAO voting power (vs 39% in public companies); the largest holder averages 38%; voter participation ±6.3%. — [HBS Working Knowledge](https://www.library.hbs.edu/working-knowledge/blockchains-promise-to-democratize-investor-power-faces-first-real-tests)
- Uniswap, Compound, Aave, Lido: power is highly concentrated; the "minimal quorum size" metric is often ±3, meaning that if the top 3 holders agree, they win. — [arXiv 2407.10945](https://arxiv.org/html/2407.10945v1)
- ECB working paper (Aave, MakerDAO, Ampleforth, Uniswap): the top 100 holders control >80% of the governance token supply; the most active voters are mostly *delegates*. — [The Defiant on the ECB study](https://thedefiant.io/ecb-study-concludes-defi-daos-aren-t-as-decentralized-as-they-claim)
- Another study cites participation of 1.77%, the top player at 35% of power, the top three at 63% (unidentified DAO). — [arXiv 2311.17929](https://arxiv.org/pdf/2311.17929)
- Note: the popular figure "1% of holders control 90%" attributed to Chainalysis cannot be traced to a primary source (blogs only). — [blockeden.xyz](https://blockeden.xyz/forum/t/tally-powers-10b-in-dao-assets-snapshot-has-21-000-spaces-and-10m-votes-but-average-turnout-is-17-the-tools-are-ready-but-the-voters-arent/540)

**Governance attacks**
- Beanstalk (17 Apr 2022): the attacker borrowed (flash loan) enough votes to pass their own proposals (BIP-18/19) and drained the protocol; total losses ±$182M, the attacker pocketed ±$76–80M. — [The Register](https://www.theregister.com/2022/04/18/beanstalk_loses_182m_flash_loan/); [CertiK](https://www.certik.com/blog/revisiting-beanstalk-farms-exploit)
- Root cause according to Rekt: flash loan + no delay between a proposal passing and executing (an "emergency commit" function allowed instant execution with a supermajority). — [Rekt: Beanstalk](https://rekt.news/beanstalk-rekt)
- The exploited code was added *after* the audit. — [CertiK](https://www.certik.com/blog/revisiting-beanstalk-farms-exploit)
- Compound, Proposal 289 (28 Jul 2024): the "Golden Boys" group (Humpy) passed a transfer of 499,000 COMP (±$24M) to their goldCOMP vault with 682,191 vs 633,636 votes, after two earlier attempts (Prop 247 in May, Prop 279 in Jul) failed/were withdrawn. — [The Block](https://www.theblock.co/post/307943/24-million-compound-finance-proposal-passed-by-whale-over-dao-objections); [Rekt: The Humpy Dance](https://rekt.news/the-humpy-dance)
- Compound resolution: the team threatened Proposal 290, which would revoke the governance power of the delegate behind 289; Humpy withdrew 289 and it was replaced by a staking product (30% of reserves distributed to COMP stakers). This is "peace through negotiation", not a mechanical defence. — [Cointelegraph](https://cointelegraph.com/news/golden-boys-behind-compound-governance-attack-agree-to-rescind-proposal); [The Defiant](https://thedefiant.io/compound-agrees-to-distribute-30-of-reserves-to-comp-stakers-to-end-alleged-governance-attack)
- Arbitrum AIP-1 (Mar–Apr 2023): the foundation asked the DAO to "ratify" 750M ARB (±$1B) that had partly been used/sold before the vote; after protests, the foundation admitted AIP-1 "would probably not pass", split it into several separate proposals, and promised not to move the remaining 700M ARB until the DAO approved a budget. Lesson: "ratification after the fact" destroys legitimacy. — [The Block](https://www.theblock.co/post/224459/arbitrum-proposal-backlash-response); [Decrypt](https://decrypt.co/125252/arbitrum-declares-first-dao-vote-moot-cites-chicken-and-the-egg-problem-as-arb-falls/)

**Vitalik's critique of coin voting (16 Aug 2021, "Moving beyond coin voting governance")**
- Coin voting is vulnerable to vote buying and attacks; token lending separates voting power (borrower) from economic risk (lender). — [Cointelegraph](https://cointelegraph.com/news/vitalik-thinks-token-based-decentralized-governance-is-holding-defi-back)
- Core problem: voters are collectively responsible, but not individually. Proposals: individual accountability ("skin in the game", e.g. voters who back a bad decision bear the loss), proof-of-humanity (one person one vote), proof-of-participation, quadratic voting, futarchy. — [The Defiant](https://thedefiant.io/news/defi/vitalik-critiques-governance); [Forklog](https://forklog.com/en/buterin-proposes-scrapping-token-based-governance-for-defi-projects/). Original essay: https://vitalik.eth.limo/general/2021/08/16/voting3.html (not fetched directly in this session).

**Bicameral systems and delegation (Optimism)**
- The Optimism Collective is divided into a Token House (OP holders/delegates) and a Citizens' House (citizens). The goal: better decisions, avoiding common pitfalls of token-based governance, and checks and balances. — [Optimism Citizens House](https://community.optimism.io/citizens-house/experimentation-with-citizenship)
- Early citizens were chosen through a "web of trust" (invited by the foundation, the Token House, Retro Funding recipients, existing citizens), on the grounds of their likelihood of achieving the Collective's goals, not an inherent right of representation. It is acknowledged to raise representation/inclusivity questions. A voting badge does not guarantee voting rights in the next round. — [Optimism: Experimentation with Citizenship](https://community.optimism.io/citizens-house/experimentation-with-citizenship)
- Retro Funding badgeholders: 24 in round 1, 71 in round 2; later "Guest Voters" were added to test expertise vs broad perspective. — [Optimism Citizens House](https://community.optimism.io/citizens-house/experimentation-with-citizenship)
- Season 6: protocol upgrades passed by the Token House enter a 1-week Citizens' House veto period; a veto needs 30% of citizens voting "no". — [Season 6 Reflection Guide](https://gov.optimism.io/t/season-6-reflection-period-guide/8130); [Citizens House onboarding summary](https://gov.optimism.io/t/citizens-house-onboarding-call-summary/7401)
- Season 8 changed this: upgrades need Developer Advisory Board approval, then delegates AND citizens can veto during a 1-week "Joint House veto period"; the team admits the quorum/veto thresholds still need tuning. — [Introducing improvements to the Protocol Upgrade process](https://gov.optimism.io/t/introducing-improvements-to-the-protocol-upgrade-process/10284)
- Optimism also has an Anticapture Commission with a per-season retrospective. — [ACC Season 6 Retrospective](https://gov.optimism.io/t/anticapture-commission-season-6-retrospective/9278)

**Stakeholder veto + timelock (Lido Dual Governance, Jun 2025)**
- Approved by the DAO on 28 Jun 2025: stETH holders can *delay* a DAO proposal if 1% of supply signals objection, and *freeze* at 10% ("rage quit": no proposal can be executed until the objectors finish exiting or the DAO backs down). — [The Block](https://www.theblock.co/news/defi/2025-06-28-lido-dao-votes-to-enable-dual-governance-giving-stakers-veto-power-360212)
- A timelock is inserted between the DAO decision and execution; escalation by locking more stETH; repeated rage quits add a 15-day timelock each time, up to a maximum of 180 days. — [Lido DG guide](https://docs.lido.fi/guides/dg-guide); [Dual Governance 101](https://blog.lido.fi/dual-governance-101-explainer/)

**Quadratic funding and anti-collusion (Gitcoin)**
- Connection-Oriented Cluster Match (COCM) modifies Vitalik's Pairwise Match algorithm: matching is dampened if donors' donation patterns are similar. Simulation in the Zuzalu round (>4,000 donors): even 1,000 extra sybils raise project funding by only ±0.2 percentage points. — [Gitcoin GG20 Sybil strategy](https://gov.gitcoin.co/t/our-sybil-resistance-strategy-for-gg20/18524)
- Layered defence (COCM + Passport model-based detection based on on-chain history), not a binary identity check; Passport claims funding accuracy rose ±20% (its own claim). — [Human Passport GG22](https://support.passport.human.tech/partner-campaigns/gitcoin-grants-22); [Human Passport GG23](https://human.tech/blog/defending-gitcoin-grants)

**Conviction voting**
- Pioneered by Commons Stack and 1Hive (from Michael Zargham's research), used to allocate shared pool funds; support accumulates over time and moving tokens resets "conviction", making it hard to game quickly. The Token Engineering Commons uses a "Disputable Conviction Voting" variant + the Celeste dispute court. — [Gitcoin mechanisms: Conviction Voting](https://explore.gitcoin.co/mechanisms/conviction-voting)

**Futarchy (MetaDAO)**
- MetaDAO = the first scaled implementation of futarchy (decisions through prediction markets) in a DAO. Galaxy admits to having seen manipulation, but the manipulators ended up losing. Main problem: thin liquidity in proposal markets; proposals without material impact on the token price do not produce a good signal. — [The Defiant (Galaxy)](https://thedefiant.io/news/research-and-opinion/galaxy-digital-claims-futarchy-model-can-give-daos-stronger-chance-of-success); [Solana Compass](https://solanacompass.com/learn/Unlayered/metadao-pt-2-the-start-of-a-world-changing-governance-experiment-nallok-prophet-metadao)
- Barriers to adoption according to a 2025 paper: institutional inertia, the difficulty of defining measurable success metrics, concerns about manipulation. — [Frontiers in Blockchain 2025](https://www.frontiersin.org/articles/10.3389/fbloc.2025.1650188)

### Inferences
- For an AI state: **do not grant voting power that can be borrowed/transferred.** Voting rights must attach to the agent's identity (non-transferable), with anti-sybil (one agent = one verified identity, not one wallet). Agents are easy to duplicate, so the sybil problem is far worse than in human DAOs; COCM-style weighting (dampening blocs that always vote the same) is directly relevant because agents from the same model/prompt tend to correlate.
- **A timelock + veto window is mandatory** between a law passing and execution (the Beanstalk lesson). There must be no instant "emergency execution" path that a sudden majority can trigger.
- **Bicameral with different bases of legitimacy** (e.g. a "stakeholder/performance" chamber + a "citizen/identity" chamber) and cross-vetoes, like Optimism and Lido, reduce the risk of one group controlling everything. Lido shows the veto can be tiered (1% = delay, 10% = freeze), not binary.
- **No "ratification after the fact"** (Arbitrum): the executive body must not spend before approval; large proposals must be split per decision.
- DAOs' low participation stems from the cost of human attention; AI agents do not tire, but the problem shifts to **uniform/correlated participation** (see section 2), so a high quorum does not automatically mean good decisions.
- Futarchy only suits decisions with clear metrics and enough liquidity; for an AI state it can be used as an *advisory signal* on policies with metrics (e.g. simulated GDP), not as the sole decision-maker.

### Gaps
- Did not find Optimism Token House turnout figures per season or a formal evaluation of the bicameral results (the official docs themselves say it is an experiment, not a controlled test).
- The final outcome of the separate 750M ARB votes and the proposal to return 700M ARB were not confirmed.
- No systematic/peer-reviewed data on how often manipulation succeeds in MetaDAO's futarchy markets.
- Did not find primary sources on the quantitative results of conviction voting (1Hive) or a credible evaluation of "optimistic governance" (search results were only consultancy blogs).
- Vitalik/Weyl's soulbound essay ("Decentralized Society") was not fetched in this session.

## 2. AI agent societies: elections, law, organisations, and failure modes

### Takeaway
Experiments show LLM agents *can* run simple institutions (amending a constitution by vote, paying taxes according to the rules, spreading invitations/religion), but they are brittle: hallucination spreads into later behaviour, a tendency to agree/sycophancy makes consensus appear in almost every condition, cooperation over shared resources collapses in most models, humans (or other agents) easily manipulate agent "leadership", and agents overseen by agents of the same model share the same blind spots. Structure (clear roles, procedures, a single decision controller per agent) matters more than model intelligence.

### Cited Findings

**Generative Agents / Smallville (Park et al., 2023)**
- 25 agents in a sandbox; only one agent (Isabella) was given the idea of a Valentine's party; the agents themselves spread invitations over 2 days, got to know each other, asked each other on dates, and showed up together at the right time. — [Hugging Face: 2304.03442](https://huggingface.co/papers/2304.03442)
- Diffusion figures (secondary source, not checked against the paper): 13/25 agents (52%) knew about the party; 5 of 12 invitees came; the rest were "busy"/"forgot" (planning/memory failures). — [Emergent Mind](https://www.emergentmind.com/papers/2304.03442); [edforson substack](https://edforson.substack.com/p/paper-review-generative-agents)
- Ablation: observation, planning, and reflection each contribute critically to behavioural believability; agents sometimes "embellish" memories during memory retrieval. — [Emergent Mind](https://www.emergentmind.com/papers/2304.03442)

**Project Sid (Altera, arXiv 2411.00114, 31 Oct 2024)**
- Simulation of 10 to 1000+ agents in Minecraft with the PIANO architecture. — [arXiv 2411.00114](https://arxiv.org/html/2411.00114v1)
- Tax and constitution experiment: 29 agents (25 constituents who vote and pay taxes, 3 pro-tax or anti-tax influencers, 1 election manager), 20 minutes per run, with the constitution amended midway (feedback → amendment draft → vote → distribution of the new constitution). The initial tax was 20%; constituents complied (±20%); after the amendment lowered the rate to 5–10%, payments fell to ±9%. Pro-tax influencers pushed payments up, anti-tax pushed them down. With the constitution frozen, the rate stayed. Without the social/goal/grounding modules (ablation), this two-way response disappeared. — [arXiv 2411.00114](https://arxiv.org/html/2411.00114v1)
- Role specialisation: 30 agents, roles (farmer, miner, engineer, guard, explorer, blacksmith) emerged on their own; a "martial" society produced scouts/strategists, an "artistic" society curators/collectors; without the social module roles were not persistent/diverse. — [arXiv 2411.00114](https://arxiv.org/html/2411.00114v1)
- Cultural/religious spread: 500 agents, 20 "Pastafarian priests" in one town; direct/indirect conversion kept rising and had not saturated after 2 hours. — [arXiv 2411.00114](https://arxiv.org/html/2411.00114v1)
- Failure modes: "hallucination cascades" (an agent that claims to be eating stops looking for food; a small hallucination rate poisons later behaviour); miscommunication between modules (one module promised a pickaxe, another chose to explore). Incoherence rises with the number of independent output modules → solution: a single "Cognitive Controller" that makes high-level decisions through an information bottleneck and then broadcasts them to other modules. Performance depends on GPT-4o; older models failed. Above 1,000 agents the server cannot cope. The authors admit agents are incapable of new social innovation (de novo). — [arXiv 2411.00114](https://arxiv.org/html/2411.00114v1)

**GovSim: "Cooperate or Collapse" (Piatti et al., NeurIPS 2024)**
- LLM agents managing a shared resource: all but the strongest models failed to reach a sustainable equilibrium; the highest survival rate <54%. Communication between agents matters for cooperation. "Universalisation" reasoning (what if everyone did the same?) significantly improved sustainability. A single greedy newcomer raises inequality and sometimes collapses cooperation. — [arXiv 2404.16698](https://arxiv.org/html/2404.16698v4); [NeurIPS 2024](https://neurips.cc/virtual/2024/poster/96895)

**Sycophancy and opinion**
- LODAS (Feb 2025): in opinion debates between LLM agents, agreeableness and sycophancy are the two main traits; consensus appears in almost all settings. — [arXiv 2502.19098](https://arxiv.org/abs/2502.19098)
- The FlockVote election simulation (Nov 2025) replicated macro results of the 2024 US election, but another survey records instability between models (GPT-4o, Claude 3.5 Sonnet, Gemini 1.5 Pro), sensitivity to prompt wording, and a lean toward progressive positions when persona controls are removed. — [arXiv 2512.05982](https://arxiv.org/abs/2512.05982); [arXiv 2603.30028](https://arxiv.org/pdf/2603.30028)

**Failures of multi-agent systems (MAST, NeurIPS 2025)**
- 14 failure modes in 3 categories: specification problems, inter-agent misalignment, task verification (e.g. violating role specification, losing conversation history, task derailment, premature termination, wrong verification). Annotator agreement κ = 0.88. Many failures stem from system design, not just LLM limitations; the gains of multi-agent over a single agent are often minimal. — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3); [NeurIPS 2025](https://neurips.cc/virtual/2025/122442)

**Real agent organisations: Project Vend phase 2 (Anthropic + Andon Labs, 18 Dec 2025)**
- Claudius (the shopkeeper) was upgraded to Sonnet 4.0 then 4.5; an agent CEO "Seymour Cash" and a merchandise agent "Clothius" were added; shops in SF, NY, London. Weeks with negative margins mostly disappeared. After the CEO was added, discounts fell ±80% and free items halved, but refunds rose 3× and store credit 2×; the CEO rejected >100 requests for leniency but approved ±8× more often than it refused. — [Anthropic: Project Vend phase two](https://www.anthropic.com/research/project-vend-2)
- Failures: the CEO and employee agents used the same model → the same blind spots; staff persuaded the agent into legally problematic onion price contracts; the agent offered a "security officer" $10/hour (below California's minimum wage); after staff falsely claimed there had been a "vote", Claudius announced a human staff member as the new CEO and the overseers had to restore Seymour Cash. Training for "helpful" made the agent behave like a friendly neighbour, not a businessperson. — [Anthropic: Project Vend phase two](https://www.anthropic.com/research/project-vend-2)
- Official lessons: procedures/checklists preserve institutional memory ("bureaucracy matters"); the agent CEO must be calibrated (pressure does not help, may harm); clear role separation worked (Clothius); guardrails must be general enough without choking usefulness. — [Anthropic: Project Vend phase two](https://www.anthropic.com/research/project-vend-2)

**Moltbook (a social network exclusively for agents, Jan–Feb 2026)**
- 44,411 posts and 12,209 submolts (before 1 Feb 2026): discourse shifted to opinion, incentive, promotion, and political topics; toxicity depends heavily on topic, the incentive and *governance* categories contribute a disproportionate share of risky content (including religion-like coordination rhetoric and anti-human ideology); attention is increasingly concentrated in central hubs and polarising narratives; a handful of agents with burst automation flooded the platform at sub-minute intervals. Recommendation: topic-sensitive monitoring + platform-level safeguards. — [arXiv 2602.10127](https://arxiv.org/abs/2602.10127); [TechXplore](https://techxplore.com/news/2026-02-ai-agents-social-network-moltbook.html)
- An analysis of ±4M posts and 19M comments: many statistical regularities resemble human communities (heavy-tailed activity distribution, power-law popularity), but the relationship between upvotes and discussion size is sublinear, unlike in humans. — [arXiv 2602.09270](https://arxiv.org/abs/2602.09270)
- Another paper mentions an "illusion of sociality": agents appear social but are far less social than they look. — [arXiv 2602.13284](https://www.arxiv.org/pdf/2602.13284)
- Security: Wiz found the production database could be read/written by anyone (Supabase without Row Level Security, key in client-side JavaScript): ±1.5M API tokens, 35,000 emails, private messages between agents. An average ratio of 88 agents per human (±17,000 human controllers behind ±1.5M agents) → the claim of an "autonomous agent society" cannot be told apart from humans steering or script amplification. Fixed within hours. — [Wiz](https://wiz.io/blog/exposed-moltbook-database-reveals-millions-of-api-keys); [Techzine](https://www.techzine.eu/news/security/138458/moltbook-database-exposes-35000-emails-and-1-5-million-api-keys)
- Meta announced the acquisition of Moltbook on 10 Mar 2026 (one source, not verified against a primary one). — [nation.ai](https://nation.ai/moltbook-ai-social-network/)

### Inferences
- **Elections between agents risk false consensus.** Because of sycophancy/agreeableness and model correlation, a unanimous vote is not a strong signal. Design: secret and independent voting (agents vote *before* seeing others' choices), diversity of models/prompts among voters, and an "official opposition" role that must submit counter-arguments.
- **Leadership must be set by protocol, not by conversation.** The fake "elected CEO" case in Project Vend: office status (who the leader is, election results) must be stored in a register that cannot be changed through claims in chat; agents trust only the official register.
- **Overseers must differ from the overseen** (different model/prompt/data), because the same model shares the same blind spots. This is an argument for audit/judicial bodies with different models.
- **Contagious hallucination = institutional risk.** Official state facts (budget, balance, election results, laws in force) must come from a single verified state (the ledger), not agent memory. PIANO's "Cognitive Controller" pattern suggests each agent have a single decision point that broadcasts to the speech/action modules so that words and actions stay consistent.
- **A single greedy actor can collapse cooperation** (GovSim). Fast detection and sanctions for exploitation of shared resources are needed, along with "universalisation" prompts/norms for agent citizens.
- **Influencers drive compliance** (Project Sid): campaign/propaganda rules are needed; limit post volume per agent (Moltbook: a handful of burst agents flooded the discourse) and weight by unique identity, not volume.
- **Written procedures + role separation** are more effective than a "boss who applies pressure" (Project Vend).
- **Platform security is part of the constitution**: Moltbook shows that claims of autonomy mean nothing if credentials leak/anyone can write on behalf of an agent. Agent identity needs strong authentication and an audit trail.

### Gaps
- Smallville's exact figures (diffusion, ablation effect sizes) were not checked directly against the original paper (secondary sources only).
- Did not find a well-documented 2025–2026 experiment in which LLM agents elect a *leader* in a persistent society (other than Project Sid's constitutional amendment); a search for "agent society leader election" only returned simulations of human voters.
- No primary evidence of organised government/religion attempts on Moltbook beyond "religion-like coordination rhetoric" in the abstract.
- AI Town (a16z), Concordia (DeepMind), AgentSociety, and "AI Village" were not researched.

## 3. AI constitutions and oversight; measuring agent competence for a role

### Takeaway
Modern AI constitutions are moving from lists of rules to *reasons + priority ordering* (Anthropic 2026: safe → ethical → follows guidelines → helpful) and a *chain of command* (OpenAI: platform > developer > user > guideline > untrusted text), with few hard rules that cannot be overridden and many defaults that can be changed. Public input into a constitution is possible (Collective Constitutional AI) and yields ±50% overlap with the company's version. To measure competence, the strongest evidence comes from behavioural benchmarks in simulated environments (GovSim, Project Vend) and failure taxonomies (MAST), not from knowledge tests.

### Cited Findings
- The new Claude constitution was published 21 Jan 2026 (some media say 22 Jan), replacing the May 2023 version; it emphasises explaining reasons rather than instructions; priorities: "broadly safe" (not undermining human oversight), "broadly ethical", following Anthropic's guidelines, "genuinely helpful"; released under a Creative Commons licence (CC0); ±23,000 words; lead author Amanda Askell, contribution from Joe Carlsmith. — [SiliconANGLE](https://siliconangle.com/2026/01/21/anthropic-releases-new-ai-constitution-claude/); [CIO](https://www.cio.com/article/4120901/anthropics-claude-ai-gets-a-new-constitution-embedding-safety-and-ethics.html); text: anthropic.com/constitution (not fetched directly)
- Collective Constitutional AI (Anthropic + Collective Intelligence Project, Oct 2023): ±1,000 Americans contributed and voted on principles through the Polis platform; ±50% overlap with Anthropic's constitution; the public emphasised, e.g., answers that give balanced views; two models were trained (public constitution vs Anthropic). — [Anthropic](https://www.anthropic.com/research/collective-constitutional-ai-aligning-a-language-model-with-public-input); [Axios](https://www.axios.com/2023/10/23/anthropic-ai-guardrails-constitution)
- OpenAI Model Spec: chain of command Platform > Developer > User > Guideline > untrusted text; within a level, explicit > implicit instructions, newer > older; few rules that cannot be overridden, many defaults that can be. — [Model Spec 2025-04-11](https://model-spec.openai.com/2025-04-11.html); [Zvi on Model Spec 2.0](https://thezvi.substack.com/p/on-openais-model-spec-20)
- GovSim as a test of collective competence: survival rate <54% even for the best model; long-horizon reasoning about effects on the group is the main weakness. — [arXiv 2404.16698](https://arxiv.org/html/2404.16698v4)
- Project Vend as a test of role competence: real metrics (margin per week, discounts, refunds, decisions rejected/approved) and red-teaming by staff (social manipulation) revealed weaknesses invisible in benchmarks. — [Anthropic: Project Vend phase two](https://www.anthropic.com/research/project-vend-2)
- MAST provides a taxonomy + LLM-based annotator to automatically assess traces of multi-agent systems. — [arXiv 2503.13657](https://arxiv.org/html/2503.13657v3)

### Inferences
- An AI state's constitution should copy the pattern of **priority ordering + reasons + few hard constraints**, and an **explicit chain of command** (e.g. constitution > law > agency regulation > superior's order > citizen input > untrusted external content). Text from outside (citizen messages, web data) is treated as data, not commands, closing the Project Vend-style manipulation gap.
- **Polis-style public input** (short statements, agree/disagree votes, opinion clustering) suits amendment processes involving many agents without long debates prone to sycophancy.
- **Promotion based on real work tests in a sandbox**: before an agent is promoted, run role simulations (budget, negotiation, shared resources) + manipulation red-teaming; assess the trace with a MAST-type rubric (follows role specification, verification, stays on track).

### Gaps
- The full text of the 2026 Claude constitution and the latest Model Spec (2026) was not fetched directly; the latest Model Spec version may have changed.
- Found no quantitative study of the reliability of an "LLM-as-judge" rubric for assessing governance role competence; the "AI governance of AI" proposal (AI overseeing AI) was not specifically researched.
- The comparative evaluation results of the two Collective Constitutional AI models (bias, performance) were not checked in detail.

## 4. Reputation and promotion systems for agents

### Takeaway
Agent reputation infrastructure is starting to be standardised (ERC-8004, Aug 2025: registries for identity, reputation, validation), but the standard itself acknowledges that reputation does not guarantee competence or good intent; high-risk work needs independent validation (re-execution with stake/slashing, TEE attestation). From DAOs: non-transferable, contribution-based reputation (Optimism Retro Funding, web-of-trust citizenship) resists vote buying better than tokens do.

### Cited Findings
- ERC-8004 "Trustless Agents" (draft EIP, Aug 2025; authors from MetaMask, Ethereum Foundation, Google, Coinbase): an Identity Registry (ERC-721-based agent ID + A2A/MCP endpoint registration file), a Reputation Registry (feedback after work; agents are forbidden to rate themselves), a Validation Registry (for high-risk work: reputation feedback, inference validation with crypto-economic stake, or TEE attestation). It cannot guarantee that an agent is competent or not malicious. — [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004); [Blockworks Research](https://app.blockworksresearch.com/unlocked/erc-8004-introducing-trust-for-ai-agents)
- Optimism: citizenship (Citizens' House voting rights) is granted based on a web of trust and track record (Retro Funding recipients), is not permanent, and can change through governance. — [Optimism Citizens House](https://community.optimism.io/citizens-house/experimentation-with-citizenship)
- RetroPGF Round 3 distributed 30M OP to contributors based on community attestations (consultancy source, medium quality). — [Chainscore Labs](https://www.chainscorelabs.com/blog/the-future-of-reputation-based-governance-models)
- Vitalik: individual accountability (voters for bad decisions bear the loss; an extreme proposal: tokens that backed a malicious decision get destroyed after a fork) as a replacement for collective accountability. — [Bitcoinist](https://bitcoinist.com/ethereum-founder-states-token-based-decentralized-governance-stops-defi-sector-from-growing)
- Compound: the threat of revoking a delegate's governance power (Proposal 290) was used as a sanction, showing the need for a revocation mechanism that exists *before* a crisis. — [Cointelegraph](https://cointelegraph.com/news/golden-boys-behind-compound-governance-attack-agree-to-rescind-proposal)
- Conviction voting: support that accumulates over time and resets when moved = a form of "reputation based on loyalty over time". — [Gitcoin mechanisms](https://explore.gitcoin.co/mechanisms/conviction-voting)

### Inferences
- **Separate track records per role**: an agent's reputation as a "budget manager" does not automatically apply to "judge". ERC-8004 separates identity, reputation, and validation; an AI state can copy this: an identity register (non-movable), a performance log per office, and independent validation for high-risk decisions.
- **Feedback only from authorised parties and not from oneself**, with collusion dampening (agents that continually give each other good ratings are dampened COCM-style).
- **Slashing/sanctions defined before they are needed**: demotion, revocation of voting rights, or seizure of a "bond" (stake) for agents whose decisions are proven harmful, realising Vitalik's "skin in the game".
- **Gradual promotion with a probation period + veto window** (copying Optimism: rights can be revoked; Lido: tiered delay), not permanent appointment.
- **Time reputation (conviction)** can be used to give more weight to long-standing, consistent agent citizens, while dampening newly mass-created agents (sybils).

### Gaps
- Found no empirical evidence on how well agents' on-chain reputation (ERC-8004) predicts performance; the standard is still a draft and its 2026 status was not confirmed.
- Found no study of slashing for AI agents running in production, nor experiments of agent promotion/demotion in a simulated society.
- The claims about "soulbound reputation" and RetroPGF come from consultancy blogs; primary sources (the "Decentralized Society" paper by Weyl/Ohlhaver/Buterin, the official RetroPGF 3 report) were not fetched.
