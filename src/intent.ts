// Agent IA rapide : Claude ne produit QUE l'intention (quelques chiffres), le réseau est construit ici sur les vraies rues.
// Avant : Claude émettait chaque nœud et chaque conduite (≈ 16 k jetons, ~1 min). Maintenant : ~100 jetons + générateur local.
import { fetchStreets } from './streets';
import { generateInp, osmXmlToGraph } from './generate';
import { searchPlace } from './geo';
import { importInp, type Net } from './net';

// OSM et Nominatim refusent un client sans User-Agent (Node) ; le navigateur ignore cet en-tête et envoie le sien
const UA = { 'User-Agent': 'water-network-demo/1.0' };

export type Intent = { place: string; n_nodes: number; demand_lps: number; head_m: number; summary: string };

/** Secours sans clé API / hors ligne : lit les chiffres du cahier des charges, pour que la démo ne tombe jamais. */
export function parseIntent(spec: string): Intent {
  const num = (re: RegExp) => { const m = spec.match(re); return m ? parseFloat(m[1].replace(/\s/g, '').replace(',', '.')) : undefined; };
  const logements = num(/(\d[\d\s]*)\s*logements/i), hab = num(/(\d[\d\s]*)\s*hab(?:itants)?\b(?!\/)/i);
  const dot = num(/(\d+(?:[.,]\d+)?)\s*L\/hab/i) ?? 150, pointe = num(/pointe\s*(?:de\s*)?(\d+(?:[.,]\d+)?)/i) ?? 2;
  const people = hab ?? (logements ? logements * (num(/(\d+(?:[.,]\d+)?)\s*hab\/logement/i) ?? 5) : undefined);
  const demand = num(/(\d+(?:[.,]\d+)?)\s*L\/s/i) ?? (people ? (people * dot / 86400) * pointe : 40);
  const n = num(/(\d+)\s*n(?:œ|oe)uds/i) ?? Math.round(Math.min(150, Math.max(30, demand * 1.2)));
  const place = spec.match(/(?:^|\s)(?:à|au|in|ville de)\s+([A-ZÉ][\p{L}'-]+(?:[\s-][A-ZÉ][\p{L}'-]+)*)/u)?.[1] ?? '';
  return { place, n_nodes: n, demand_lps: Math.round(demand * 10) / 10, head_m: num(/(\d+)\s*m\s*(?:de\s*)?(?:hauteur|charge)/i) ?? 45, summary: `Réseau de ${n} nœuds, ${demand.toFixed(1)} L/s au total (lecture locale du cahier des charges).` };
}
console.assert(parseIntent('quartier de 40 nœuds à Sousse, 25 L/s').n_nodes === 40 && parseIntent('quartier de 40 nœuds à Sousse, 25 L/s').demand_lps === 25 && parseIntent('40 nœuds à Sousse').place === 'Sousse', 'parseIntent self-check');

/** Intention → réseau maillé sous les rues OSM (altitudes Open-Meteo), réservoir au point haut. */
export async function buildFromIntent(it: Intent, center: [number, number], step: (s: string) => void = () => {}): Promise<{ net: Net; at: [number, number] }> {
  const at = (it.place && await searchPlace(it.place).catch(() => null)) || center;
  step('rues');
  const radius = Math.round(Math.min(1500, Math.max(250, Math.sqrt(it.n_nodes) * 45)));
  // API OSM (bbox ~1 km², < 2 s) d'abord ; Overpass (plus lent, parfois saturé) en secours
  const dLat = radius / 111320, dLng = radius / (111320 * Math.cos(at[0] * Math.PI / 180));
  const bbox = [at[1] - dLng, at[0] - dLat, at[1] + dLng, at[0] + dLat].map((x) => x.toFixed(5)).join(',');
  const g = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${bbox}`, { headers: UA }).then((r) => (r.ok ? r.text() : Promise.reject())).then(osmXmlToGraph)
    .then((x) => (Object.keys(x.pts).length > it.n_nodes ? x : Promise.reject())).catch(() => fetchStreets(at, radius));
  step('réseau');
  const inp = await generateInp(g, { center: at, nodes: it.n_nodes, demandLps: it.demand_lps, headM: it.head_m, title: it.summary });
  return { net: importInp(inp, at), at };
}
