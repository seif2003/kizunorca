import type { NetworkState, NetworkNode, NodeType } from '@orcanet/contracts/network';
import { DEFAULT_SIM_OPTIONS, DEFAULT_OPT_CONFIG } from '@orcanet/contracts/network';
import { parseINP } from '@orcanet/engine-core/epanetIO';
import { networkCost } from '@orcanet/engine-core/networkCost';
import type { HydraulicResults } from '@orcanet/contracts/resultats';
import { runHydraulicSimulation } from '@orcanet/engine-core/hydraulics';
import { elevations, haversine } from './geo';

export type Net = NetworkState;
export const SIM = DEFAULT_SIM_OPTIONS;
export const emptyNet = (): Net => ({ nodes: {}, pipes: {}, pumps: {}, valves: {}, patterns: {}, curves: {} });

const nextId = (rec: Record<string, unknown>, p: string) => { let i = 1; while (rec[p + i]) i++; return p + i; };
export const ll = (n: NetworkNode): [number, number] => [n.lat!, n.lng!];

/** z = cote du sol ; pour un réservoir/château, `elevation` porte la charge (sol + hauteur d'eau). */
export function makeNode(id: string, type: NodeType, lat: number, lng: number, z: number, demand = 0, head = 0): NetworkNode {
  const base = { id, type, label: id, lat, lng, x: lng, y: lat, coteSol: z };
  if (type === 'reservoir') return { ...base, elevation: z + (head || 30) };
  if (type === 'tank') return { ...base, elevation: z + (head || 20), initLevel: 3, minLevel: 0.5, maxLevel: 5, tankDiameter: 15 };
  return { ...base, elevation: z, demand };
}

export async function addNode(net: Net, type: NodeType, lat: number, lng: number): Promise<Net> {
  const [z] = await elevations([[lat, lng]]);
  const id = nextId(net.nodes, type === 'junction' ? 'N' : type === 'tank' ? 'T' : 'R');
  return { ...net, nodes: { ...net.nodes, [id]: makeNode(id, type, lat, lng, z, type === 'junction' ? 1 : 0) } };
}

export function addLink(net: Net, kind: 'pipe' | 'pump', a: string, b: string, diameter = 110): Net {
  if (a === b) return net;
  if (kind === 'pump') {
    const id = nextId(net.pumps, 'PU');
    return { ...net, pumps: { ...net.pumps, [id]: { id, label: id, fromId: a, toId: b, power: 10, speed: 1 } } };
  }
  const id = nextId(net.pipes, 'P');
  const length = Math.max(1, Math.round(haversine(ll(net.nodes[a]), ll(net.nodes[b]))));
  return { ...net, pipes: { ...net.pipes, [id]: { id, label: id, fromId: a, toId: b, length, diameter, roughness: 130, minorloss: 0, status: 'open' } } };
}

/** Réseau proposé par l'agent IA → NetworkState, altitudes relevées automatiquement. */
export async function fromAgent(a: AgentNet): Promise<Net> {
  const z = await elevations(a.nodes.map((n) => [n.lat, n.lng]));
  let net = emptyNet();
  a.nodes.forEach((n, i) => { net.nodes[n.id] = makeNode(n.id, n.kind, n.lat, n.lng, z[i], n.demand_lps, n.extra_head_m); });
  for (const p of a.pipes) if (net.nodes[p.from] && net.nodes[p.to]) net = addLink(net, 'pipe', p.from, p.to, p.diameter_mm);
  for (const p of a.pumps) if (net.nodes[p.from] && net.nodes[p.to]) {
    net = addLink(net, 'pump', p.from, p.to);
    const id = Object.keys(net.pumps).at(-1)!;
    net.pumps[id].power = p.power_kw;
  }
  return net;
}
export interface AgentNet {
  summary: string;
  nodes: { id: string; kind: NodeType; lat: number; lng: number; demand_lps: number; extra_head_m: number }[];
  pipes: { id: string; from: string; to: string; diameter_mm: number }[];
  pumps: { id: string; from: string; to: string; power_kw: number }[];
}

export const simulate = (net: Net): HydraulicResults => runHydraulicSimulation(net, SIM);

/**
 * Jumeau numérique — localisation de fuite par signature de pression.
 * Pour chaque nœud candidat on simule une fuite (émetteur) et on compare, aux capteurs, la chute de pression
 * simulée à la chute mesurée (similarité cosinus : indépendante de l'ampleur inconnue de la fuite).
 */
export function locateLeak(net: Net, sensors: string[], measuredDrop: Record<string, number>, top = 3) {
  const base = simulate(net).nodePressure;
  const m = sensors.map((s) => measuredDrop[s] ?? 0);
  const norm = (v: number[]) => Math.hypot(...v) || 1;
  return Object.values(net.nodes)
    .filter((n) => n.type === 'junction')
    .map((n) => {
      const p = simulate(withLeak(net, n.id)).nodePressure;
      const d = sensors.map((s) => base[s] - p[s]);
      return { id: n.id, score: d.reduce((acc, v, i) => acc + v * m[i], 0) / (norm(d) * norm(m)) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
}
export const withLeak = (net: Net, id: string, c = 2): Net =>
  ({ ...net, nodes: { ...net.nodes, [id]: { ...net.nodes[id], emitterCoeff: c } } });

/** Capteurs de pression : nœuds les plus sensibles aux fuites, choisis de façon gloutonne pour couvrir le réseau. */
export function proposePressureSensors(net: Net, k: number): string[] {
  const juncs = Object.values(net.nodes).filter((n) => n.type === 'junction').map((n) => n.id);
  const base = simulate(net).nodePressure;
  // signatures[j] = chute de pression à chaque nœud pour une fuite en j
  const sig = juncs.map((j) => { const p = simulate(withLeak(net, j)).nodePressure; return juncs.map((s) => base[s] - p[s]); });
  const chosen: number[] = [];
  const best = juncs.map(() => 0); // meilleure détection actuelle de chaque fuite
  for (let t = 0; t < Math.min(k, juncs.length); t++) {
    let arg = -1, gain = -1;
    for (let s = 0; s < juncs.length; s++) {
      if (chosen.includes(s)) continue;
      const g = sig.reduce((acc, row, j) => acc + Math.max(0, row[s] - best[j]), 0);
      if (g > gain) { gain = g; arg = s; }
    }
    chosen.push(arg);
    sig.forEach((row, j) => { best[j] = Math.max(best[j], row[arg]); });
  }
  return chosen.map((i) => juncs[i]);
}

/** Import .inp : coordonnées géographiques gardées, sinon supposées métriques et posées autour de `center`. */
export function importInp(text: string, center: [number, number]): Net {
  const n = parseINP(text).network;
  const nodes = Object.values(n.nodes);
  // shortcut: coordonnées .inp supposées métriques et posées au centre de la carte, à remplacer par une saisie de projection si besoin
  const Y = (x: NetworkNode) => 600 - x.y; // parseINP retourne l'axe y pour l'écran (y = 600 − Y du fichier)
  const geo = nodes.every((x) => Math.abs(x.x) <= 180 && Math.abs(Y(x)) <= 90);
  const cx = nodes.reduce((s, x) => s + x.x, 0) / nodes.length, cy = nodes.reduce((s, x) => s + Y(x), 0) / nodes.length;
  for (const x of nodes) {
    x.lat ??= geo ? Y(x) : center[0] + (Y(x) - cy) / 111320;
    x.lng ??= geo ? x.x : center[1] + (x.x - cx) / (111320 * Math.cos(center[0] * Math.PI / 180));
  }
  return n;
}
/**
 * Monnaie AFFICHÉE : dinar tunisien. Le moteur OrcaNet calcule avec son catalogue indicatif en €/m : ses pénalités
 * (pression, vitesse) sont calibrées sur cette échelle — un catalogue ×3,4 donnait un réseau 7 % plus cher et 2× plus lent
 * (banc du 21/11/2026). On laisse donc le moteur en interne et on convertit TOUT ce qui s'affiche.
 * shortcut: taux fixe indicatif, à remplacer par les prix TND réels des fournisseurs quand on les a.
 */
export const TND_PER_EUR = 3.4;
/** Coût matériel des conduites (TND). */
export const cost = (net: Net) => networkCost(net.pipes, DEFAULT_OPT_CONFIG.catalog) * TND_PER_EUR;
/** Textes du moteur : chaque montant « 12 345 € » / « 1,2 M€ » devient son équivalent en TND. */
export function toTND(t: string): string {
  return t.replace(/(\d[\d\s\u202f\u00a0]*(?:[.,]\d+)?)\s*(k|M)?\s?€(\/m)?/g, (_m, n: string, k?: string, perM?: string) => {
    const v = parseFloat(n.replace(/[\s\u202f\u00a0]/g, '').replace(',', '.')) * (k === 'M' ? 1e6 : k === 'k' ? 1e3 : 1) * TND_PER_EUR;
    return v.toLocaleString('fr-FR', { maximumFractionDigits: v < 100 ? 2 : 0 }) + ' TND' + (perM ?? '');
  });
}
console.assert(toTND('coût 1 000 € et 2,5 k€').replace(/\s/g, ' ') === 'coût 3 400 TND et 8 500 TND', 'toTND self-check');

/** Réglages de l'optimisation : choisis par le moteur propriétaire Orcadeep, côté service. */
export const DEMO_OPT = { sizingResidenceWeight: 0 };

/** Contraintes du dimensionnement (champs `OptConfig`) : le moteur les impose, `minVelocity` n'est qu'un indicateur d'auto-curage. */
export type Limits = { minPressure: number; maxVelocity: number; peakFactor: number; minVelocity: number };
export const DEFAULT_LIM: Limits = { minPressure: 20, maxVelocity: 1.2, peakFactor: 1, minVelocity: 0.3 };

/** Indicateurs hydrauliques du rapport avant / après (pression, vitesse, débit). */
export function hydroStats(net: Net, res: HydraulicResults, lim: Limits = DEFAULT_LIM) {
  const P = Object.entries(res.nodePressure).filter(([id]) => net.nodes[id]?.type === 'junction').map(([, v]) => v);
  const V = Object.keys(net.pipes).map((id) => Math.abs(res.pipeVelocity[id] ?? 0));
  const Q = Object.keys(net.pipes).map((id) => Math.abs(res.pipeFlow[id] ?? 0));
  return {
    cost: cost(net),
    pmin: P.length ? Math.min(...P) : 0,
    vmax: V.length ? Math.max(...V) : 0,
    vmean: V.length ? V.reduce((s, x) => s + x, 0) / V.length : 0,
    qmax: Q.length ? Math.max(...Q) : 0, // L/s
    lowP: P.filter((x) => x < lim.minPressure).length,
    fastV: V.filter((x) => x > lim.maxVelocity + 1e-6).length,
    slowV: V.filter((x) => x < lim.minVelocity).length,
    pipes: V.length,
  };
}
export type Stats = ReturnType<typeof hydroStats>;
/** Même mise à la pointe que le moteur (pipeSizing.peakFactorNodes) : demandes des nœuds × k. */
export function atPeak(net: Net, k: number): Net {
  if (k === 1) return net;
  const nodes = { ...net.nodes };
  for (const nd of Object.values(net.nodes)) if (nd.type === 'junction')
    nodes[nd.id] = { ...nd, demand: (nd.demand ?? 0) * k, demands: (nd.demands ?? []).map((c) => ({ ...c, base: (c.base ?? 0) * k })) };
  return { ...net, nodes };
}
/** Simulation au débit de pointe + indicateurs. */
export const peakStats = (net: Net, lim: Limits = DEFAULT_LIM) => { const n = atPeak(net, lim.peakFactor); return hydroStats(n, simulate(n), lim); };
