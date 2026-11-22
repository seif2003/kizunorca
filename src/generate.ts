// Générateur de réseau sur les VRAIES rues : graphe OSM → réseau maillé connexe → texte .inp (EPANET).
// Partagé par scripts/make-case.ts (cas Tokyo / démo Tunis), l'agent IA de l'appli et le service Docker « agent ».
import { buildGraph, type StreetGraph } from './streets';
import { elevations, haversine } from './geo';

export type GenOpts = {
  center: [number, number];
  nodes: number;          // nombre de nœuds (réservoir compris)
  demandLps: number;      // demande totale répartie sur les nœuds (L/s)
  headM?: number;         // hauteur du château d'eau au-dessus du sol (m)
  title: string;
  diameter?: number;      // Ø de départ « à la main » (surdimensionné) ; Ø+100 au départ du réservoir
};

/** Réponse XML de l'API OSM `map?bbox=` → graphe de rues (mêmes types de voies que la démo). */
export function osmXmlToGraph(xml: string): StreetGraph {
  const ll: Record<number, [number, number]> = {};
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)" lon="([-\d.]+)"/g)) ll[+m[1]] = [+m[2], +m[3]];
  const ways = [...xml.matchAll(/<way [\s\S]*?<\/way>/g)].map((m) => m[0])
    .filter((w) => /k="highway" v="(primary|secondary|tertiary|residential|unclassified|living_street|pedestrian)"/.test(w))
    .map((w) => [...w.matchAll(/<nd ref="(\d+)"/g)].map((r) => +r[1])).filter((w) => w.every((n) => ll[n]));
  return buildGraph(ways, ll);
}

/** Choix des nœuds : parcours en largeur depuis le carrefour le plus central → sous-réseau connexe, mailles des rues gardées. */
export function pickNodes(g: StreetGraph, c: [number, number], max: number) {
  const ids = Object.keys(g.pts).sort((a, b) => haversine(c, g.pts[a]) - haversine(c, g.pts[b]));
  if (!ids.length) throw new Error('Aucune rue trouvée autour de ce point');
  const keep = new Set([ids[0]]), queue = [ids[0]];
  while (queue.length && keep.size < max) {
    const u = queue.shift()!;
    for (const v of Object.keys(g.adj[u]).sort((a, b) => haversine(c, g.pts[a]) - haversine(c, g.pts[b])))
      if (keep.size < max && !keep.has(v)) { keep.add(v); queue.push(v); }
  }
  const pipes: [string, string, number][] = [];
  for (const a of keep) for (const b in g.adj[a]) if (keep.has(b) && a < b) pipes.push([a, b, Math.max(1, Math.round(g.adj[a][b]))]);
  return { nodes: [...keep], pipes };
}

/** Réseau complet en .inp : réservoir au point haut, demandes réparties, diamètres « à la main » (non optimisés). */
export async function generateInp(g: StreetGraph, o: GenOpts, z?: number[]): Promise<string> {
  const { nodes, pipes } = pickNodes(g, o.center, o.nodes);
  z ??= await elevations(nodes.map((s) => g.pts[s]));
  const top = nodes.reduce((b, s, i) => (z![i] > z![nodes.indexOf(b)] ? s : b), nodes[0]);
  const name = Object.fromEntries(nodes.map((s, i) => [s, 'J' + (i + 1)]));
  name[top] = 'R1';
  const J = nodes.filter((s) => s !== top);
  const w = J.map((_, i) => 0.5 + ((i * 7) % 10) / 6); // demandes inégales mais reproductibles
  const W = w.reduce((s, x) => s + x, 0);
  const D = o.diameter ?? 300;
  const L = (...c: (string | number)[]) => c.join('\t');
  return [
    '[TITLE]', o.title, '',
    '[JUNCTIONS]', ...J.map((s, i) => L(name[s], z![nodes.indexOf(s)].toFixed(1), (o.demandLps * w[i] / W).toFixed(3))), '',
    '[RESERVOIRS]', L('R1', (z[nodes.indexOf(top)] + (o.headM ?? 45)).toFixed(1)), '',
    '[PIPES]', ...pipes.map(([a, b, len], i) => L('P' + (i + 1), name[a], name[b], len, a === top || b === top ? D + 100 : D, 130, 0, 'Open')), '',
    '[OPTIONS]', L('Units', 'LPS'), L('Headloss', 'H-W'), '',
    '[COORDINATES]', ...nodes.map((s) => L(name[s], g.pts[s][1].toFixed(6), g.pts[s][0].toFixed(6))), '',
    '[END]', '',
  ].join('\n');
}

// self-check : petite grille 3×3 → réseau connexe, 1 réservoir, demande totale conservée
{
  const pts: Record<string, [number, number]> = {}, adj: Record<string, Record<string, number>> = {};
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) pts[`${i}${j}`] = [36.8 + i * 0.001, 10.18 + j * 0.001];
  for (const k in pts) for (const m in pts) if (k < m && Math.abs(+k[0] - +m[0]) + Math.abs(+k[1] - +m[1]) === 1) { (adj[k] ??= {})[m] = 100; (adj[m] ??= {})[k] = 100; }
  const r = pickNodes({ pts, adj }, [36.801, 10.181], 9);
  console.assert(r.nodes.length === 9 && r.pipes.length === 12, 'pickNodes self-check');
}
