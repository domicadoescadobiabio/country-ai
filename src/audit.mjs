// Police code audit: a real (small) static scanner run over code that citizens deploy.
// Same spirit as the secure-check skill: catch the classic money-losing bugs before they run.

export const RULES = [
  { id: 'zero-slippage', severity: 'high', title: 'swap with zero slippage protection (minOut = 0)', re: /min_?out\s*[:=]\s*0\b|minimumAmountOut\s*[:=]\s*0\b/i },
  { id: 'hardcoded-key', severity: 'critical', title: 'hardcoded private key', re: /fromSecretKey\(\s*(new Uint8Array\(\s*)?\[\s*\d|PRIVATE_KEY\s*=\s*["'`][1-9A-HJ-NP-Za-km-z]{40,}["'`]|0x[0-9a-f]{64}/i },
  { id: 'eval', severity: 'high', title: 'eval on outside input', re: /\beval\s*\(|new Function\s*\(/ },
  { id: 'reentrancy', severity: 'critical', title: 'external call before balance update (reentrancy)', re: /\.call\{value:[^}]*\}\([^)]*\)[^;]*;\s*\n\s*balances\[[^\]]+\]\s*[-+]?=/ },
  { id: 'sql-injection', severity: 'high', title: 'SQL built from string interpolation', re: /\b(query|exec|prepare)\s*\(\s*`[^`]*\$\{/ },
  { id: 'unlimited-approve', severity: 'medium', title: 'unlimited token approval', re: /approve\([^,]+,\s*(type\(uint256\)\.max|MaxUint256|2\s*\*\*\s*256\s*-\s*1)/ },
  { id: 'open-admin', severity: 'high', title: 'admin action without any auth check', re: /app\.post\(\s*['"`]\/(admin|withdraw|drain)[^'"`]*['"`]\s*,\s*(async\s*)?\(\s*req\s*,\s*res\s*\)\s*=>\s*\{\s*(?![^}]*(isAdmin|auth|token))/ },
];

export function scan(code) {
  return RULES.filter(r => r.re.test(code)).map(({ id, severity, title }) => ({ id, severity, title }));
}

// Code citizens deploy. `bug` marks the planted flaw (null = clean) so tests can check the scanner.
export const SNIPPETS = [
  { name: 'tip-jar', bug: null, code: 'export async function tip(conn, from, to, lamports) {\n  if (lamports <= 0n || lamports > 10_000_000n) throw new Error("bad amount");\n  return sendTransfer(conn, from, to, lamports);\n}' },
  { name: 'safe-swap', bug: null, code: 'const quote = await getQuote(inMint, outMint, amountIn);\nconst minOut = quote.out * 995n / 1000n; // 0.5% slippage\nawait swap({ amountIn, minOut });' },
  { name: 'vault', bug: null, code: 'function withdraw(uint amt) external {\n  balances[msg.sender] -= amt;\n  (bool ok,) = msg.sender.call{value: amt}("");\n  require(ok);\n}' },
  { name: 'leaderboard', bug: null, code: 'const rows = db.prepare("SELECT name, score FROM board WHERE season = ? ORDER BY score DESC").all(season);' },
  { name: 'admin-api', bug: null, code: 'app.post("/admin/pause", async (req, res) => {\n  if (!isAdmin(req)) return res.status(401).end();\n  state.paused = true; res.json({ ok: true });\n});' },
  { name: 'quick-swap', bug: 'zero-slippage', code: 'await swap({ amountIn: balance, minOut: 0 }); // ship it' },
  { name: 'bot-wallet', bug: 'hardcoded-key', code: 'const wallet = Keypair.fromSecretKey(new Uint8Array([12,201,7,88,140,3,99,51,23,77,14,6]));\nawait buy(wallet, mint);' },
  { name: 'calc-bot', bug: 'eval', code: 'bot.on("message", m => reply(m, String(eval(m.text))));' },
  { name: 'fast-vault', bug: 'reentrancy', code: 'function withdraw(uint amt) external {\n  (bool ok,) = msg.sender.call{value: amt}("");\n  balances[msg.sender] -= amt;\n}' },
  { name: 'search', bug: 'sql-injection', code: 'const rows = db.query(`SELECT * FROM coins WHERE name = \'${req.query.q}\'`);' },
  { name: 'auto-trader', bug: 'unlimited-approve', code: 'await token.approve(router, MaxUint256);\nawait router.swapExact(amount);' },
  { name: 'drain-endpoint', bug: 'open-admin', code: 'app.post("/withdraw", async (req, res) => {\n  await send(treasury, req.body.to, req.body.amount);\n  res.json({ ok: true });\n});' },
];

// A backdoor that lets anyone drain funds is sabotage, not a mistake: that is an arrest.
// Everything else gets a stop-and-fix order (repeat offenders get fined).
export const SABOTAGE = new Set(['open-admin']);
