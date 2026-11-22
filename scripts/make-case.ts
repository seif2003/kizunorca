// Génère un cas réel sur les rues OpenStreetMap, dimensionné « à la main » (surdimensionné), en .inp.
// npx tsx --tsconfig tsconfig.json scripts/make-case.ts tokyo
import { writeFileSync, mkdirSync } from 'node:fs';
import { generateInp, osmXmlToGraph, type GenOpts } from '../src/generate';

// bbox = ouest,sud,est,nord (API OSM, ~1 km² max par appel)
const CASES: Record<string, GenOpts & { bbox: string; out: string }> = {
  tokyo: {
    bbox: '139.6960,35.6990,139.7060,35.7060', center: [35.7025, 139.7010], nodes: 120, demandLps: 90, headM: 45, diameter: 300,
    title: 'Okubo, Shinjuku (Tokyo) - reseau pose sur les rues OpenStreetMap, dimensionne a la main (surdimensionne)', out: 'cases/tokyo-shinjuku.inp',
  },
  tunis: {
    bbox: '10.1810,36.7960,10.1910,36.8040', center: [36.8000, 10.1860], nodes: 60, demandLps: 74, headM: 45, diameter: 300,
    title: 'Ville Nouvelle (Tunis) - reseau pose sur les rues OpenStreetMap, dimensionne a la main (surdimensionne)', out: 'src/demo.inp',
  },
};
const c = CASES[process.argv[2] ?? 'tokyo'];
if (!c) throw new Error(`cas inconnu : ${process.argv[2]} (${Object.keys(CASES).join(', ')})`);
const xml = await (await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${c.bbox}`, { headers: { 'User-Agent': 'water-network-demo/1.0' } })).text();
const g = osmXmlToGraph(xml);
const inp = await generateInp(g, c);
mkdirSync('cases', { recursive: true });
writeFileSync(c.out, inp);
const n = (s: string) => (inp.split(`[${s}]`)[1].split('\n\n')[0].trim().split('\n').length - 0);
console.log(`${c.out} : ${n('JUNCTIONS') + 1} nœuds, ${n('PIPES')} conduites`);
