// Print the engine fingerprint of this checkout: the same value /api/health shows as build.code.
//   node scripts/ops/code-hash.mjs
// If it matches production, the deployment runs exactly this server.mjs, src/ and db/.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeHash } from '../../src/util.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
console.log(codeHash(root));
