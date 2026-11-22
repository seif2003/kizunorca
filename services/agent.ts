// Service agent IA : cahier des charges → intention (Claude). La clé API ne vit QUE dans ce conteneur.
// Sans clé ou en cas d'échec : lecture locale du cahier des charges (parseIntent), la démo ne tombe jamais.
import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { parseIntent, type Intent } from '../src/intent';

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['place', 'n_nodes', 'demand_lps', 'head_m', 'summary'],
  properties: { place: { type: 'string' }, n_nodes: { type: 'integer' }, demand_lps: { type: 'number' }, head_m: { type: 'number' }, summary: { type: 'string' } },
} as const;
const SYSTEM = `Tu es un ingénieur hydraulicien. Lis le cahier des charges et rends seulement l'intention de conception :
place = ville ou quartier explicitement nommé (sinon ""), n_nodes = nombre de nœuds du réseau (30 à 150, ~1 nœud par carrefour desservi),
demand_lps = débit total de pointe en L/s (population × dotation × coefficient de pointe / 86 400 si besoin), head_m = hauteur du château d'eau au-dessus du sol (défaut 45),
summary = 2 phrases en français qui résument le réseau.`;
const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

async function intent(spec: string): Promise<Intent & { source: string }> {
  if (!client) return { ...parseIntent(spec), source: 'local' };
  try {
    const r = await client.messages.create({
      model: 'claude-opus-5-5', max_tokens: 1024, system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: spec }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    const text = r.content.find((b) => b.type === 'text');
    if (r.stop_reason === 'refusal' || !text || text.type !== 'text') throw new Error(`réponse ${r.stop_reason}`);
    return { ...JSON.parse(text.text), source: 'claude' };
  } catch (e) {
    console.warn('Claude indisponible, lecture locale :', (e as Error).message);
    return { ...parseIntent(spec), source: 'local' };
  }
}

http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/intent') { res.writeHead(404).end(); return; }
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', async () => {
    let spec = '';
    try { spec = String(JSON.parse(b).spec ?? ''); } catch { /* corps invalide → 400 */ }
    if (!spec.trim()) { res.writeHead(400, { 'Content-Type': 'application/json' }).end('{"error":"spec requis"}'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(await intent(spec)));
  });
}).listen(+(process.env.PORT ?? 8081), () => console.log('agent prêt', client ? '(Claude)' : '(lecture locale, sans clé)'));
