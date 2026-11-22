import { haversine } from './geo';
import type { AgentNet } from './net';

/**
 * Rues OpenStreetMap (Overpass) → graphe : sommets = carrefours et virages, arêtes = tronçons de rue (longueur réelle).
 * Sert à poser les conduites SOUS les rues, comme sur le terrain.
 */
export type StreetGraph = { pts: Record<string, [number, number]>; adj: Record<string, Record<string, number>> };

const ROADS = 'primary|secondary|tertiary|residential|unclassified|living_street|service';

export async function fetchStreets(c: [number, number], radiusM: number): Promise<StreetGraph> {
  const q = `[out:json][timeout:25];way(around:${radiusM},${c[0]},${c[1]})["highway"~"^(${ROADS})$"];(._;>;);out body;`;
  let r: Response | null = null;
  for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter']) { // miroir si le serveur principal est saturé
    r = await fetch(url, {
      method: 'POST', headers: { Accept: 'application/json', 'User-Agent': 'water-network-demo/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q),
    }).catch(() => null);
    if (r?.ok) break;
  }
  if (!r?.ok) throw new Error(`Rues OpenStreetMap indisponibles (${r?.status ?? 'réseau'})`);
  const els: { type: string; id: number; lat?: number; lon?: number; nodes?: number[] }[] = (await r.json()).elements;
  const ll: Record<number, [number, number]> = {};
  for (const e of els) if (e.type === 'node') ll[e.id] = [e.lat!, e.lon!];
  const ways = els.filter((e) => e.type === 'way' && e.nodes!.every((n) => ll[n])).map((e) => e.nodes!);
  return buildGraph(ways, ll);
}

/** Garde les carrefours (nœud partagé par 2 rues ou extrémité) et les virages > 20° ; le reste est fondu dans le tronçon. */
export function buildGraph(ways: number[][], ll: Record<number, [number, number]>): StreetGraph {
  const uses: Record<number, number> = {};
  for (const w of ways) w.forEach((n, i) => { uses[n] = (uses[n] ?? 0) + (i === 0 || i === w.length - 1 ? 2 : 1); });
  const g: StreetGraph = { pts: {}, adj: {} };
  const link = (a: number, b: number, d: number) => {
    if (a === b) return;
    for (const [x, y] of [[a, b], [b, a]]) { g.pts[x] = ll[x]; (g.adj[x] ??= {})[y] = Math.min(g.adj[x][y] ?? Infinity, d); }
  };
  for (const w of ways) {
    let last = w[0], acc = 0;
    for (let i = 1; i < w.length; i++) {
      acc += haversine(ll[w[i - 1]], ll[w[i]]);
      const end = i === w.length - 1;
      if (end || uses[w[i]] > 1 || bend(ll[w[i - 1]], ll[w[i]], ll[w[i + 1]]) > 20) { link(last, w[i], acc); last = w[i]; acc = 0; }
    }
  }
  return g;
}
function bend(a: [number, number], b: [number, number], c: [number, number]) {
  const h1 = Math.atan2(b[1] - a[1], b[0] - a[0]), h2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  const d = Math.abs(h1 - h2) * 180 / Math.PI;
  return Math.min(d, 360 - d);
}

export function nearest(g: StreetGraph, p: [number, number]): string {
  let best = '', bd = Infinity;
  for (const id in g.pts) { const d = haversine(p, g.pts[id]); if (d < bd) { bd = d; best = id; } }
  return best;
}

/** Plus court chemin par les rues (Dijkstra simple, graphes de quartier de quelques centaines de sommets). */
export function route(g: StreetGraph, a: string, b: string): string[] {
  const dist: Record<string, number> = { [a]: 0 }, prev: Record<string, string> = {}, done = new Set<string>();
  while (true) {
    let u = '', du = Infinity;
    for (const k in dist) if (!done.has(k) && dist[k] < du) { du = dist[k]; u = k; }
    if (!u || u === b) break;
    done.add(u);
    for (const v in g.adj[u]) if (du + g.adj[u][v] < (dist[v] ?? Infinity)) { dist[v] = du + g.adj[u][v]; prev[v] = u; }
  }
  if (a !== b && !prev[b]) return [];
  const path = [b];
  while (path[0] !== a) path.unshift(prev[path[0]]);
  return path;
}

// self-check : deux rues en T → 3 carrefours, route A→C passe par B
{
  const ll = { 1: [0, 0], 2: [0, 0.001], 3: [0, 0.002], 4: [0.001, 0.001] } as Record<number, [number, number]>;
  const g = buildGraph([[1, 2, 3], [2, 4]], ll);
  console.assert(route(g, '1', '3').join() === '1,2,3' && Object.keys(g.pts).length === 4, 'streets self-check');
}

/**
 * Réseau de l'agent IA → posé sur les rues : chaque nœud va au carrefour le plus proche,
 * chaque conduite suit le plus court chemin par les rues (virages et carrefours deviennent des nœuds sans demande).
 */
export function snapToStreets(a: AgentNet, g: StreetGraph): AgentNet {
  const sid: Record<string, string> = {}, out = new Map<string, AgentNet['nodes'][number]>();
  const RANK = { reservoir: 2, tank: 1, junction: 0 };
  for (const n of a.nodes) {
    const s = nearest(g, [n.lat, n.lng]);
    sid[n.id] = s;
    const prev = out.get(s); // deux nœuds sur le même carrefour : fusion (demandes additionnées, la source l'emporte)
    if (!prev) out.set(s, { ...n, lat: g.pts[s][0], lng: g.pts[s][1] });
    else out.set(s, { ...(RANK[n.kind] > RANK[prev.kind] ? n : prev), lat: prev.lat, lng: prev.lng, demand_lps: prev.demand_lps + n.demand_lps });
  }
  const pipes = new Map<string, number>();
  for (const p of a.pipes) {
    const path = route(g, sid[p.from], sid[p.to]);
    const legs = path.length > 1 ? path : [sid[p.from], sid[p.to]]; // rues non reliées : tracé direct
    for (let i = 1; i < legs.length; i++) {
      if (legs[i - 1] === legs[i]) continue;
      const k = [legs[i - 1], legs[i]].sort().join('|');
      pipes.set(k, Math.max(pipes.get(k) ?? 0, p.diameter_mm));
    }
  }
  for (const k of pipes.keys()) for (const s of k.split('|'))
    if (!out.has(s)) out.set(s, { id: 'S' + s, kind: 'junction', lat: g.pts[s][0], lng: g.pts[s][1], demand_lps: 0, extra_head_m: 0 });
  const id = (s: string) => out.get(s)!.id;
  return {
    ...a,
    nodes: [...out.values()],
    pipes: [...pipes].map(([k, d], i) => { const [x, y] = k.split('|'); return { id: 'P' + (i + 1), from: id(x), to: id(y), diameter_mm: d }; }),
    pumps: a.pumps.map((p) => ({ ...p, from: id(sid[p.from]), to: id(sid[p.to]) })),
  };
}
