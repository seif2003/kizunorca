import proj4 from 'proj4';
export { haversine } from '@orcanet/engine-core/geo';

/** Altitudes (m) via Open-Meteo (DEM Copernicus 90 m), par paquets de 100 — même source qu'OrcaNet. */
export async function elevations(pts: [number, number][]): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 100) {
    const p = pts.slice(i, i + 100);
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${p.map((x) => x[0].toFixed(6))}&longitude=${p.map((x) => x[1].toFixed(6))}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Altitudes indisponibles (${r.status})`);
    out.push(...(await r.json()).elevation);
  }
  return out;
}

/**
 * « 36.8, 10.18 » (lat, lng) ou « 600000 4070000 32 » (X Y fuseau UTM nord, WGS84).
 * Sinon null → recherche par nom.
 */
export function parseCoords(s: string): [number, number] | null {
  const n = s.trim().split(/[\s,;]+/).map(Number);
  if (n.some(isNaN)) return null;
  if (n.length === 2 && Math.abs(n[0]) <= 90 && Math.abs(n[1]) <= 180) return [n[0], n[1]];
  if (n.length === 3 && n[2] >= 1 && n[2] <= 60) {
    const [lng, lat] = proj4(`+proj=utm +zone=${n[2]} +datum=WGS84 +units=m`, 'WGS84', [n[0], n[1]]);
    return [lat, lng];
  }
  return null;
}

export async function searchPlace(q: string): Promise<[number, number] | null> {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'water-network-demo/1.0' } }); // requis hors navigateur
  const [hit] = r.ok ? await r.json() : [];
  return hit ? [+hit.lat, +hit.lon] : null;
}

// self-check : parseCoords
console.assert(parseCoords('36.8, 10.18')?.[0] === 36.8, 'parseCoords latlng');
console.assert(Math.abs((parseCoords('600000 4070000 32')?.[0] ?? 0) - 36.77) < 0.05, 'parseCoords UTM');
console.assert(parseCoords('Tunis') === null, 'parseCoords nom');
