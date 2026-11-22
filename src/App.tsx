import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { NodeType } from '@orcanet/contracts/network';
import { pressureColor } from '@orcanet/engine-core/hydraulics';
import { emptyNet, addNode, addLink, simulate, ll, importInp, type Net } from './net';
import { parseCoords, searchPlace } from './geo';
import Panel from './Panel';
import { probe, type Cluster } from './remote';
import { listProjects, saveProject, newProject, type Project } from './projects';

export type Mode = 'potable' | 'irrigation';
type Tool = 'select' | NodeType | 'pipe' | 'pump';
/** Surbrillances posées par les modules : nodeId → [couleur, étiquette]. */
export type Marks = Record<string, [string, string]>;

const TOOLS: [Tool, string, string][] = [
  ['select', '↖', 'Choisir'], ['junction', '●', 'Nœud'], ['reservoir', '▣', 'Réserv.'],
  ['tank', '◫', 'Château'], ['pipe', '╱', 'Conduite'], ['pump', '⟲', 'Pompe'],
];
// Conduites : couleurs vives lisibles sur l'image satellite (cyan → jaune → rose), posées sur un liseré sombre.
const PIPE_STOPS = [[0, 229, 255], [255, 214, 10], [255, 46, 99]];
function pipeColor(t: number) {
  const k = Math.max(0, Math.min(1, t)) * 2, i = Math.min(1, Math.floor(k)), f = k - i;
  return `rgb(${PIPE_STOPS[i].map((c, j) => Math.round(c + (PIPE_STOPS[i + 1][j] - c) * f)).join(',')})`;
}
const TYPE_COLOR = { junction: '#f3eee4', reservoir: '#6bb7b2', tank: '#d8b25a' };
// NDVI MODIS 8 jours (NASA GIBS, sans clé) — date d'il y a 3 semaines pour tomber sur un composite publié
const NDVI_DATE = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);

export default function App() {
  // dernier projet ouvert (ou un premier projet vide) : l'état démarre dessus, l'enregistrement auto ne l'écrase donc jamais
  const [init] = useState<Project>(() => listProjects()[0] ?? saveProject(newProject('Projet 1', 'potable', emptyNet()))[0]);
  const [mode, setMode] = useState<Mode>(init.mode);
  const [tool, setTool] = useState<Tool>('junction');
  const [net, setNet] = useState<Net>(init.net);
  const [sel, setSel] = useState<string | null>(null);
  const [marks, setMarks] = useState<Marks>({});
  const [fly, setFly] = useState<[number, number] | null>(null);
  const [center, setCenter] = useState<[number, number]>([36.8065, 10.1815]);
  const [ndvi, setNdvi] = useState(false);
  const [clu, setClu] = useState<Cluster>(null);
  useEffect(() => { const t = () => probe().then(setClu); t(); const i = setInterval(t, 5000); return () => clearInterval(i); }, []); // badge ☁ cluster
  const [base, setBase] = useState<'sat' | 'plan'>('sat'); // fond : image satellite ou schéma (rues seules)
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [simOn, setSimOn] = useState(false);
  const [toast, setToast] = useState('');
  const [projects, setProjects] = useState<Project[]>(listProjects);
  const [pid, setPid] = useState(init.id);
  const [name, setName] = useState(init.name);
  const [demo, setDemo] = useState(0);
  const [agent, setAgent] = useState(0);
  const [simTab, setSimTab] = useState(0);
  const [opt, setOpt] = useState(0);

  useEffect(() => { const n = Object.values(init.net.nodes)[0]; if (n) setFly([n.lat!, n.lng!]); }, [init]);
  // enregistrement automatique du projet courant
  useEffect(() => { setProjects(saveProject({ id: pid, name, mode, net, updated: 0 })); }, [net, mode, name]); // eslint-disable-line react-hooks/exhaustive-deps

  function openProject(p: Project) {
    setPid(p.id); setName(p.name); setMode(p.mode); setNet(p.net); setSel(null); setMarks({}); setSimOn(false);
    const n = Object.values(p.net.nodes)[0];
    if (n) setFly([n.lat!, n.lng!]);
  }
  function createProject(n: string, network: Net, m: Mode = mode) {
    const p = newProject(n, m, network);
    setProjects(saveProject(p));
    openProject(p);
  }

  const res = useMemo(() => {
    const hasSource = Object.values(net.nodes).some((n) => n.type !== 'junction');
    if (!simOn || !hasSource || !Object.keys(net.pipes).length) return null;
    try { return simulate(net); } catch { return null; }
  }, [net, simOn]);
  function runSim() {
    setSimOn(true);
    const hasSource = Object.values(net.nodes).some((n) => n.type !== 'junction');
    if (!hasSource || !Object.keys(net.pipes).length) return flash('Il faut un réservoir (ou château) et au moins une conduite');
    try {
      const r = simulate(net);
      const P = Object.entries(r.nodePressure).filter(([id]) => net.nodes[id]?.type === 'junction').map(([, v]) => v);
      flash(`Simulation OK · ${P.length} nœuds · pression ${Math.min(...P).toFixed(1)} → ${Math.max(...P).toFixed(1)} m`);
      setSimTab((k) => k + 1); // ouvre l'onglet des résultats
    } catch (e) { flash('Simulation impossible : ' + (e as Error).message); }
  }
  function flash(t: string) { setToast(t); setTimeout(() => setToast(''), 5000); }
  const maxQ = res ? Math.max(1e-6, ...Object.values(res.pipeFlow).map(Math.abs)) : 1;

  useEffect(() => setNdvi(mode === 'irrigation'), [mode]);
  useEffect(() => {
    const del = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' || !sel || (e.target as HTMLElement).tagName === 'INPUT') return;
      setNet((n) => {
        const keep = <T extends { fromId: string; toId: string }>(r: Record<string, T>) =>
          Object.fromEntries(Object.entries(r).filter(([, l]) => l.fromId !== sel && l.toId !== sel));
        const { [sel]: _, ...nodes } = n.nodes;
        return { ...n, nodes, pipes: keep(n.pipes), pumps: keep(n.pumps) };
      });
      setSel(null);
    };
    window.addEventListener('keydown', del);
    return () => window.removeEventListener('keydown', del);
  }, [sel]);

  /** Fichier EPANET (.inp) → nouveau projet à son nom, posé sur la carte et simulé tout de suite. */
  async function importFile(f?: File) {
    if (!f) return;
    if (!/\.inp$/i.test(f.name)) return flash('Choisissez un fichier EPANET (.inp)');
    try {
      const n = importInp(await f.text(), center);
      if (!Object.keys(n.nodes).length) return flash('Fichier .inp vide ou illisible');
      createProject(f.name.replace(/\.inp$/i, ''), n);
      setSimOn(true);
      flash(`Importé : ${Object.keys(n.nodes).length} nœuds, ${Object.keys(n.pipes).length} conduites — ▶ Simuler puis ⚡ Optimiser`);
    } catch (e) { flash('Import impossible : ' + (e as Error).message); }
  }

  async function onMapClick(lat: number, lng: number) {
    if (tool === 'select') return setSel(null);
    const type: NodeType = tool === 'reservoir' || tool === 'tank' ? tool : 'junction';
    setBusy('Altitude…');
    try {
      const next = await addNode(net, type, lat, lng);
      const id = Object.keys(next.nodes).find((k) => !net.nodes[k])!;
      // en mode conduite/pompe, cliquer sur la carte prolonge le tracé depuis le nœud courant
      setNet(sel && (tool === 'pipe' || tool === 'pump') ? addLink(next, tool, sel, id) : next);
      setSel(id);
    } catch (e) { alert((e as Error).message); }
    setBusy('');
  }
  function onNodeClick(id: string) {
    if ((tool === 'pipe' || tool === 'pump') && sel && sel !== id) setNet((n) => addLink(n, tool, sel, id));
    setSel(id);
  }
  async function go() {
    const p = parseCoords(q) ?? (await searchPlace(q));
    if (p) setFly(p); else alert('Lieu introuvable');
  }

  return (
    <div className="app">
      <header className="top">
        <div className="logo">Kizun<b>Orca</b><small>jumeau numérique · Kizuna 2026</small></div>
        <button className="btn primary" onClick={runSim} title="Lancer le calcul hydraulique">▶ Simuler</button>
        <label className="btn" title="Ouvrir un fichier EPANET (.inp) — ou glissez-le sur la carte">📂 Importer .inp
          <input type="file" accept=".inp" hidden onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} /></label>
        <button className="btn" onClick={() => setDemo((d) => d + 1)} title="Import EPANET → optimisation du coût">★ Démo complète</button>
        <button className="btn" onClick={() => setAgent((d) => d + 1)} title="Concevoir un réseau à partir d'un cahier des charges">✦ Agent IA</button>
        <button className="btn primary" onClick={() => setOpt((k) => k + 1)} title="Optimiser le coût du réseau affiché">⚡ Optimiser</button>
        <div className="seg">
          {(['potable', 'irrigation'] as Mode[]).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'potable' ? 'Eau potable' : 'Irrigation'}</button>
          ))}
        </div>
        <label className="row muted"><input type="checkbox" checked={ndvi} onChange={(e) => setNdvi(e.target.checked)} /> Santé végétation (NDVI)</label>
        <span className={'cluster' + (clu ? ' on' : '')} title={clu ? `Cluster Docker : ${clu.workers} optimiseur(s), ${clu.active} calcul(s) en cours, ${clu.queued} en file` : 'Cluster Docker absent : calcul local (Web Worker)'}>
          {clu ? `☁ Cluster · ${clu.workers} workers` : '⌂ Local'}</span>
        <div className="search">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()}
            placeholder="36.8, 10.18 · X Y fuseau (600000 4070000 32) · lieu" aria-label="Recherche de coordonnées" />
          <button className="btn" onClick={go}>Aller</button>
        </div>
      </header>

      <nav className="rail" aria-label="Outils">
        {TOOLS.map(([t, icon, label]) => (
          <button key={t} className={tool === t ? 'on' : ''} onClick={() => setTool(t)} title={label} aria-label={label}>
            {icon}<span>{label}</span>
          </button>
        ))}
      </nav>

      <main className="map" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); importFile(e.dataTransfer.files[0]); }}>
        <MapContainer center={center} zoom={15} maxZoom={20} zoomControl={false}>
          {base === 'sat'
            ? <TileLayer key="sat" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={19} maxZoom={20} attribution="Esri World Imagery" />
            : <TileLayer key="plan" url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={16} maxZoom={20} attribution="Esri, HERE, Garmin, © OpenStreetMap" />}
          {ndvi && <TileLayer opacity={0.55} maxNativeZoom={9} maxZoom={20} attribution="NASA GIBS MODIS NDVI"
            url={`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_NDVI_8Day/default/${NDVI_DATE}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`} />}
          {base === 'sat' && <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}" maxNativeZoom={19} maxZoom={20} />}
          <MapHooks onClick={onMapClick} fly={fly} onMove={setCenter} />

          {[...Object.values(net.pipes), ...Object.values(net.pumps)].map((l) => {
            const a = net.nodes[l.fromId], b = net.nodes[l.toId];
            if (!a || !b) return null;
            const isPump = !('diameter' in l);
            const flow = isPump ? res?.pumpFlow[l.id] : res?.pipeFlow[l.id];
            return [
              <Polyline key={l.id + '-liseré'} positions={[ll(a), ll(b)]} interactive={false} pathOptions={{ weight: isPump ? 11 : 9, color: '#07090d', opacity: 0.8 }} />,
              <Polyline key={l.id} positions={[ll(a), ll(b)]} // react-leaflet ne met à jour le style que via pathOptions
                pathOptions={{ weight: isPump ? 7 : 5, opacity: 1, dashArray: isPump ? '2 9' : undefined, color: isPump ? '#ff2e63' : pipeColor(flow != null ? Math.abs(flow) / maxQ : 0) }}>
                <Tooltip sticky>
                  <b>{l.id}</b> {isPump ? 'pompe' : `Ø${l.diameter} mm · ${l.length} m`}
                  {flow != null && <> · {flow.toFixed(2)} L/s{!isPump && ` · ${res!.pipeVelocity[l.id].toFixed(2)} m/s`}</>}
                </Tooltip>
              </Polyline>,
            ];
          })}
          {Object.values(net.nodes).map((n) => {
            const p = res?.nodePressure[n.id];
            const m = marks[n.id];
            return (
              <CircleMarker key={n.id} center={ll(n)} radius={n.type === 'junction' ? 6 : 10}
                pathOptions={{ weight: m || sel === n.id ? 4 : 1.5, color: m?.[0] ?? (sel === n.id ? '#ec5a61' : '#14161c'), fillOpacity: 1,
                  fillColor: n.type === 'junction' && p != null ? pressureColor(p) : TYPE_COLOR[n.type] }}
                eventHandlers={{ click: (e) => { e.originalEvent.stopPropagation(); onNodeClick(n.id); } }}>
                <Tooltip key={m ? 'fixe' : 'survol'} permanent={!!m} direction="top">
                  <b>{n.id}</b>{m && ` · ${m[1]}`} · sol {(n.coteSol ?? n.elevation).toFixed(1)} m{p != null && n.type === 'junction' && ` · ${p.toFixed(1)} m`}
                </Tooltip>
              </CircleMarker>
            );
          })}
        </MapContainer>
        <div className="mapbar">
          <div className="seg" role="group" aria-label="Fond de carte">
            <button className={base === 'sat' ? 'on' : ''} onClick={() => setBase('sat')}>🛰 Satellite</button>
            <button className={base === 'plan' ? 'on' : ''} onClick={() => setBase('plan')}>◫ Schéma</button>
          </div>
          <div className="counts" aria-live="polite">
            <span><b>{Object.values(net.nodes).filter((n) => n.type === 'junction').length}</b> nœuds</span>
            <span><b>{Object.values(net.nodes).filter((n) => n.type !== 'junction').length}</b> réservoirs</span>
            <span><b>{Object.keys(net.pipes).length}</b> conduites</span>
            <span><b>{(Object.values(net.pipes).reduce((t, x) => t + x.length, 0) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })}</b> km</span>
            {!!Object.keys(net.pumps).length && <span><b>{Object.keys(net.pumps).length}</b> pompes</span>}
          </div>
        </div>
        {res && <div className="legend" aria-label="Légende des pressions et débits">
          <b>Pression aux nœuds</b>
          <i style={{ background: `linear-gradient(90deg, ${[0, 20, 40, 60, 80].map(pressureColor).join(',')})` }} />
          <span><small>0</small><small>20</small><small>40</small><small>60</small><small>≥ 80 m</small></span>
          <b>Débit des conduites</b>
          <i style={{ background: `linear-gradient(90deg, ${pipeColor(0)}, ${pipeColor(0.5)}, ${pipeColor(1)})` }} />
          <span><small>faible</small><small>max {maxQ.toFixed(1)} L/s</small></span>
        </div>}
        <div className="hint">
          {busy || toast || (tool === 'pipe' || tool === 'pump'
            ? 'Cliquez un nœud puis un autre — ou cliquez la carte pour prolonger le tracé'
            : tool === 'select' ? 'Cliquez un nœud · Suppr pour l’effacer' : 'Cliquez l’image satellite pour poser — altitude relevée automatiquement')}
        </div>
      </main>

      <Panel mode={mode} net={net} setNet={setNet} res={res} marks={marks} setMarks={setMarks} center={center} setFly={setFly}
        runSim={() => setSimOn(true)} demo={demo} agent={agent} simTab={simTab} opt={opt} projects={projects} pid={pid} name={name} setName={setName}
        openProject={openProject} createProject={createProject} setProjects={setProjects} />
    </div>
  );
}

function MapHooks({ onClick, fly, onMove }: { onClick: (lat: number, lng: number) => void; fly: [number, number] | null; onMove: (c: [number, number]) => void }) {
  const map = useMap();
  useMapEvents({
    click: (e) => onClick(e.latlng.lat, e.latlng.lng),
    moveend: () => onMove([map.getCenter().lat, map.getCenter().lng]),
  });
  useEffect(() => { if (fly) map.flyTo(fly, 17); }, [fly, map]);
  return null;
}
