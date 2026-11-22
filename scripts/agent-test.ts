// Agent bout en bout hors interface : intention (cluster → Claude, sinon lecture locale) → réseau sur les rues → simulation.
// npx tsx --tsconfig tsconfig.json scripts/agent-test.ts "quartier de 40 nœuds à Sousse, 25 L/s"
import assert from 'node:assert';
import { buildFromIntent, parseIntent } from '../src/intent';
import { peakStats } from '../src/net';
const spec = process.argv[2] ?? 'Quartier résidentiel de 40 nœuds à Sousse, 25 L/s en pointe.';
const t = Date.now();
const it = await fetch('http://localhost:8787/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec }) }).then((r) => r.json()).catch(() => parseIntent(spec));
const t1 = Date.now();
const { net, at } = await buildFromIntent(it, [36.8, 10.18]);
const st = peakStats(net);
console.log(`intention (${it.source ?? 'local'}) ${(t1 - t) / 1000} s · réseau ${(Date.now() - t1) / 1000} s · ${Object.keys(net.nodes).length} nœuds, ${Object.keys(net.pipes).length} conduites à ${at.map((x) => x.toFixed(3))} · P min ${st.pmin.toFixed(1)} m`);
assert(Object.keys(net.pipes).length >= Object.keys(net.nodes).length - 1, 'réseau connexe');
