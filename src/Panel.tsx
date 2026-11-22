import { useEffect, useRef, useState } from 'react';
import type { OptObjective, OptResult } from '@orcanet/contracts/network';
import type { HydraulicResults, PumpSelectionResult } from '@orcanet/contracts/resultats';
import { exportINP } from '@orcanet/engine-core/epanetIO';
import { enFrancais } from '@orcanet/engine-core/optText';
// textes du moteur, montants convertis en TND
const tx = (t: Parameters<typeof enFrancais>[0]) => toTND(enFrancais(t));
import { applyOptResultToNetwork } from '@orcanet/engine-core/indicators';
import { CULTURES_FAO56, valeurHaute } from '@orcanet/engine-core/irrigation/besoins';
import { deleteProject, type Project } from './projects';
import demoInp from './demo.inp?raw';
import { buildFromIntent, parseIntent, type Intent } from './intent';
import { cluster, remoteIntent, remoteRun } from './remote';
import { haversine } from './geo';
// Moteur de calcul : propriété d'Orcadeep, retiré de ce dépôt — voir README.
type Job = { objective: OptObjective; net: Net; extra?: Record<string, unknown> };
const MOTEUR_PROPRIETAIRE = 'Moteur de calcul propriétaire Orcadeep : non inclus dans cette version publique.';
import { toTND, TND_PER_EUR, DEMO_OPT, emptyNet, importInp, cost, fromAgent, locateLeak, proposePressureSensors, simulate, withLeak, SIM, DEFAULT_LIM, peakStats, type Net, type AgentNet, type Limits, type Stats } from './net';
import type { Marks, Mode } from './App';

type Props = {
  mode: Mode; net: Net; setNet: (n: Net) => void; res: HydraulicResults | null;
  marks: Marks; setMarks: (m: Marks) => void; center: [number, number]; setFly: (p: [number, number]) => void;
  runSim: () => void; demo: number; agent: number; simTab: number; opt: number; projects: Project[]; pid: string; name: string; setName: (s: string) => void;
  openProject: (p: Project) => void; createProject: (name: string, net: Net, mode?: Mode) => void; setProjects: (p: Project[]) => void;
  lim?: Limits; setLim?: (l: Limits) => void; // remplis par Panel
};
declare global { interface Window { api?: { agent: (spec: string, c: [number, number]) => Promise<Intent> } } }

/** Onglets regroupés par usage ; [nom, icône, sous-titre affiché sous la barre]. */
type Tab = [string, string, string];
const GROUPS: Record<Mode, [string, Tab[]][]> = {
  potable: [
    ['Projet', [['Projets', '▤', 'Vos réseaux enregistrés'], ['Démo', '★', 'Import EPANET → optimisation du coût']]],
    ['Analyse', [['Simulation', '▶', 'Pressions, débits, vitesses'], ['Réseau', '◎', 'Synthèse, import / export .inp']]],
    ['Optimiser', [['Conduites', '⌀', 'Diamètres : coût + temps de séjour'], ['Pompage', '⟲', 'Choix de pompe et énergie'], ['Chlore', '✚', 'Boosters : où injecter, combien'], ['Contamination', '⚠', 'Capteurs pour une alerte précoce']]],
    ['Jumeau & IA', [['Jumeau', '◉', 'Capteurs de pression, fuites'], ['Agent IA', '✦', 'Cahier des charges → réseau']]],
  ],
  irrigation: [
    ['Projet', [['Projets', '▤', 'Vos réseaux enregistrés'], ['Démo', '★', 'Import EPANET → optimisation du coût']]],
    ['Analyse', [['Simulation', '▶', 'Pressions, débits, vitesses'], ['Réseau', '◎', 'Synthèse, import / export .inp'], ['Stress hydrique', '☀', 'Besoin des cultures, sécheresse']]],
    ['Optimiser', [['Conduites', '⌀', 'Diamètres : coût + temps de séjour'], ['Pompage', '⟲', 'Choix de pompe et énergie']]],
    ['Jumeau & IA', [['Jumeau', '◉', 'Capteurs de pression, fuites'], ['Agent IA', '✦', 'Cahier des charges → réseau']]],
  ],
};
/** Mode pitch (6 min) : seulement le parcours coût + vitesse + débit. */
const PITCH = new Set(['Projets', 'Démo', 'Simulation', 'Conduites', 'Agent IA']);
const TABS: Record<Mode, Tab[]> = { potable: GROUPS.potable.flatMap((g) => g[1]), irrigation: GROUPS.irrigation.flatMap((g) => g[1]) };

export default function Panel(p: Props) {
  const [tab, setTab] = useState('Réseau');
  const [pitch, setPitch] = useState(true);
  const [lim, setLim] = useState<Limits>(DEFAULT_LIM);
  const q = { ...p, lim, setLim };
  useEffect(() => { if (!TABS[p.mode].some((t) => t[0] === tab)) setTab('Réseau'); }, [p.mode, tab]);
  useEffect(() => p.setMarks({}), [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (p.demo) setTab('Démo'); }, [p.demo]);
  useEffect(() => { if (p.agent) setTab('Agent IA'); }, [p.agent]);
  useEffect(() => { if (p.simTab) setTab('Simulation'); }, [p.simTab]);
  // « ⚡ Optimiser » : la démo s'optimise sur place ; sinon l'onglet Conduites optimise le réseau affiché
  useEffect(() => { if (p.opt && tab !== 'Démo') setTab('Conduites'); }, [p.opt]); // eslint-disable-line react-hooks/exhaustive-deps
  const View = { 'Projets': Projets, 'Démo': Demo, 'Simulation': Simulation, 'Réseau': Reseau, 'Conduites': Conduites, 'Pompage': Pompage, 'Chlore': Chlore, 'Contamination': Contamination,
    'Jumeau': Jumeau, 'Agent IA': Agent, 'Stress hydrique': Stress }[tab]!;
  return (
    <aside className="panel">
      <nav className="vnav" role="tablist" aria-orientation="vertical">
        {GROUPS[p.mode].map(([g, tabs]) => [g, tabs.filter((t) => !pitch || PITCH.has(t[0]))] as const).filter(([, t]) => t.length).map(([g, tabs]) => <div key={g} className="vgroup" aria-label={g}>
          {tabs.map(([t, icon, sub]) => <button key={t} role="tab" aria-selected={t === tab} title={`${t} — ${sub}`} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
            <i>{icon}</i><span>{t === 'Stress hydrique' ? 'Stress' : t === 'Contamination' ? 'Contam.' : t}</span></button>)}
        </div>)}
        <button className="pitchsw" aria-pressed={pitch} title={pitch ? 'Afficher tous les modules' : 'Mode pitch : coût, vitesse, débit'} onClick={() => setPitch(!pitch)}><i>{pitch ? '⋯' : '◆'}</i><span>{pitch ? 'Tout' : 'Pitch'}</span></button>
      </nav>
      <div className="pmain">
        <Health {...p} />
        <div className="tabhead"><div><b>{tab}</b><small>{TABS[p.mode].find((t) => t[0] === tab)?.[2]}</small></div></div>
        <div className="body"><View {...q} /></div>
      </div>
    </aside>
  );
}

/* ─────────────── Santé du réseau : note /100, toujours visible en haut du panneau ─────────────── */
type Part = { label: string; ok: number; hint: string; weight: number };
/** Part de nœuds / conduites dans les plages de bonne pratique (AEP) — pondérée en une note sur 100. */
function health(net: Net, res: HydraulicResults): { score: number; parts: Part[] } {
  const J = Object.values(net.nodes).filter((n) => n.type === 'junction');
  const pipes = Object.values(net.pipes);
  const share = <T,>(xs: T[], f: (x: T) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 1);
  const P = (id: string) => res.nodePressure[id], V = (id: string) => Math.abs(res.pipeVelocity[id] ?? 0);
  const parts: Part[] = [
    { label: 'Pression', weight: 40, ok: share(J, (n) => P(n.id) >= 20 && P(n.id) <= 80), hint: 'nœuds entre 20 et 80 m' },
    { label: 'Vitesse', weight: 30, ok: share(pipes, (p) => V(p.id) >= 0.3 && V(p.id) <= 1.5), hint: 'conduites entre 0,3 et 1,5 m/s' },
    { label: 'Eau stagnante', weight: 15, ok: share(pipes, (p) => V(p.id) >= 0.1), hint: 'conduites au-dessus de 0,1 m/s' },
    { label: 'Calcul', weight: 15, ok: res.converged ? share(J, (n) => Number.isFinite(P(n.id))) : 0, hint: 'convergence, nœuds alimentés' },
  ];
  return { score: Math.round(parts.reduce((s, x) => s + x.ok * x.weight, 0)), parts };
}
const grade = (s: number) => (s >= 80 ? ['Bon état', 'var(--sage)'] : s >= 50 ? ['À surveiller', 'var(--gold)'] : ['Critique', 'var(--coral)']);

function Health({ net, res, runSim }: Props) {
  if (!res) return <div className="health empty">
    <div className="ring"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" className="track" /></svg><b>—</b></div>
    <div><b>Santé du réseau</b><small>Lancez une simulation pour l'évaluer</small><button className="btn" onClick={runSim}>▶ Simuler</button></div>
  </div>;
  const { score, parts } = health(net, res);
  const [label, color] = grade(score);
  return <div className="health" aria-label={`Santé du réseau ${score} sur 100, ${label}`}>
    <div className="ring">
      <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="27" className="track" />
        <circle cx="32" cy="32" r="27" className="val" style={{ stroke: color, strokeDasharray: `${(score / 100) * 169.6} 169.6` }} /></svg>
      <b>{score}</b>
    </div>
    <div className="hparts">
      <div className="row"><b>Santé du réseau</b><span className="tag" style={{ color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}>{label}</span></div>
      {parts.map((x) => <div key={x.label} className="hpart" title={x.hint}>
        <small>{x.label}</small><i><u style={{ width: `${x.ok * 100}%`, background: grade(x.ok * 100)[1] }} /></i><small>{Math.round(x.ok * 100)} %</small>
      </div>)}
    </div>
  </div>;
}

const Kpi = ({ v, l }: { v: string | number; l: string }) => <div className="kpi"><b>{v}</b><small>{l}</small></div>;
const fmt = (x: number, d = 1) => x.toLocaleString('fr-FR', { maximumFractionDigits: d });
const tnd = (x: number) => x >= 1e6 ? fmt(x / 1e6, 2) + ' M TND' : fmt(x / 1e3, 0) + ' k TND';

/* ─────────────── Contraintes de dimensionnement + rapport avant / après ─────────────── */
function Contraintes({ lim = DEFAULT_LIM, setLim }: Props) {
  const f = (k: keyof Limits, label: string, unit: string, step: number) =>
    <label className="lim">{label}<span><input type="number" step={step} min={0} value={lim[k]} onChange={(e) => setLim?.({ ...lim, [k]: Math.max(0, +e.target.value) })} />{unit}</span></label>;
  return <div className="lims" aria-label="Contraintes">
    {f('minPressure', 'Pression min', 'm', 1)}{f('maxVelocity', 'Vitesse max', 'm/s', 0.1)}{f('peakFactor', 'Facteur de pointe', '× débit', 0.1)}{f('minVelocity', 'Vitesse auto-curage', 'm/s', 0.05)}
  </div>;
}
/** Dimensionnement : les contraintes saisies passent telles quelles au moteur (minVelocity n'est qu'un indicateur). */
const optWith = (lim: Limits = DEFAULT_LIM, w = 0) => ({ ...DEMO_OPT, sizingResidenceWeight: w, minPressure: lim.minPressure, maxVelocity: lim.maxVelocity, peakFactor: lim.peakFactor });
function Rapport({ a, b, lim = DEFAULT_LIM }: { a: Stats; b?: Stats; lim?: Limits }) {
  const rows: [string, (s: Stats) => string, (s: Stats) => boolean][] = [
    ['Coût des conduites', (s) => tnd(s.cost), () => true],
    [`Conduites > ${fmt(lim.maxVelocity)} m/s`, (s) => `${s.fastV} / ${s.pipes}`, (s) => s.fastV === 0],
    [`Nœuds < ${fmt(lim.minPressure, 0)} m`, (s) => String(s.lowP), (s) => s.lowP === 0],
    ['Pression min', (s) => fmt(s.pmin) + ' m', (s) => s.pmin >= lim.minPressure],
    ['Vitesse max', (s) => fmt(s.vmax, 2) + ' m/s', (s) => s.vmax <= lim.maxVelocity + 1e-6],
    ['Vitesse moyenne', (s) => fmt(s.vmean, 2) + ' m/s', () => true],
    [`Eau lente < ${fmt(lim.minVelocity, 2)} m/s`, (s) => `${s.slowV} / ${s.pipes}`, () => true],
    ['Débit de pointe max', (s) => fmt(s.qmax) + ' L/s', () => true],
  ];
  return <table className="tbl rapport"><thead><tr><th>Au débit de pointe (× {fmt(lim.peakFactor)})</th><th>Avant</th><th>Après</th></tr></thead>
    <tbody>{rows.map(([l, v, ok]) => <tr key={l}><td>{l}</td><td className={ok(a) ? '' : 'bad'}>{v(a)}</td><td className={b ? (ok(b) ? 'good' : 'bad') : ''}>{b ? v(b) : '…'}</td></tr>)}</tbody></table>;
}

/* ─────────────── Projets enregistrés ─────────────── */
function Projets({ projects, pid, name, setName, openProject, createProject, setProjects, mode }: Props) {
  return <div className="card">
    <h2>Projets</h2>
    <label className="muted">Nom du projet courant<input value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom du projet" /></label>
    <button className="btn primary" onClick={() => createProject(`Projet ${projects.length + 1}`, emptyNet(), mode)}>＋ Nouveau projet</button>
    {projects.map((x) => (
      <div key={x.id} className={'proj' + (x.id === pid ? ' on' : '')}>
        <button className="link" onClick={() => openProject(x)} disabled={x.id === pid}>
          <b>{x.name}</b>
          <small>{x.mode === 'potable' ? 'Eau potable' : 'Irrigation'} · {Object.keys(x.net.nodes).length} nœuds · {new Date(x.updated).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</small>
        </button>
        {x.id !== pid && <button className="btn" aria-label={`Supprimer ${x.name}`} onClick={() => confirm(`Supprimer « ${x.name} » ?`) && setProjects(deleteProject(x.id))}>✕</button>}
      </div>
    ))}
  </div>;
}

/* ─────────────── Réseau : synthèse, import/export ─────────────── */
function Reseau({ net, setNet, res, center, setFly }: Props) {
  const pipes = Object.values(net.pipes);
  const P = res ? Object.entries(res.nodePressure).filter(([id]) => net.nodes[id]?.type === 'junction').map(([, v]) => v) : [];
  const V = res ? Object.values(res.pipeVelocity).map(Math.abs) : [];
  const low = P.filter((x) => x < 20).length;

  async function open(f: File) {
    const n = importInp(await f.text(), center);
    setNet(n);
    const first = Object.values(n.nodes)[0];
    if (first) setFly([first.lat!, first.lng!]);
  }
  function save() {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportINP(net, SIM, 'KizunOrca')], { type: 'text/plain' }));
    a.download = 'reseau-kizunorca.inp';
    a.click();
  }

  return <>
    <div className="card">
      <h2>Réseau</h2>
      <div className="kpis">
        <Kpi v={Object.keys(net.nodes).length} l="nœuds" />
        <Kpi v={fmt(pipes.reduce((s, x) => s + x.length, 0) / 1000, 2) + ' km'} l={`${pipes.length} conduites`} />
        <Kpi v={P.length ? fmt(Math.min(...P)) + ' m' : '—'} l="pression min" />
        <Kpi v={V.length ? fmt(Math.max(...V), 2) + ' m/s' : '—'} l="vitesse max" />
        <Kpi v={tnd(cost(net))} l="coût des conduites" />
      </div>
      {res ? (low ? <span className="tag bad">{low} nœud(s) sous 20 m de pression</span> : <span className="tag">Pressions conformes (≥ 20 m)</span>)
        : <span className="muted">Posez un réservoir, des nœuds et des conduites : le calcul hydraulique (moteur OrcaNet, équivalent EPANET) se lance tout seul.</span>}
    </div>
    <div className="card">
      <h3>Fichier</h3>
      <div className="row">
        <label className="btn">Ouvrir .inp<input type="file" accept=".inp" hidden onChange={(e) => e.target.files?.[0] && open(e.target.files[0])} /></label>
        <button className="btn" onClick={save} disabled={!pipes.length}>Exporter .inp</button>
        <button className="btn" onClick={() => setNet(emptyNet())}>Vider</button>
      </div>
    </div>
  </>;
}

/* ─────────────── Résultats de simulation ─────────────── */
function Simulation({ net, res, runSim, setFly }: Props) {
  const [view, setView] = useState<'noeuds' | 'conduites'>('noeuds');
  if (!res) return <div className="card"><h2>Résultats de simulation</h2>
    <span className="muted">Cliquez <b>▶ Simuler</b> (réservoir ou château + au moins une conduite) pour calculer pressions, débits et vitesses.</span>
    <button className="btn primary" onClick={runSim}>▶ Simuler</button></div>;
  const J = Object.values(net.nodes).filter((n) => n.type === 'junction');
  const P = J.map((n) => res.nodePressure[n.id]);
  const pipes = Object.values(net.pipes);
  const V = pipes.map((p) => Math.abs(res.pipeVelocity[p.id] ?? 0));
  const demand = J.reduce((s, n) => s + (res.nodeDemand[n.id] ?? 0), 0);
  const low = J.filter((n) => res.nodePressure[n.id] < 20), high = J.filter((n) => res.nodePressure[n.id] > 80);
  const fast = pipes.filter((p) => Math.abs(res.pipeVelocity[p.id]) > 1.5), slow = pipes.filter((p) => Math.abs(res.pipeVelocity[p.id]) < 0.1);
  const go = (id: string) => { const n = net.nodes[id]; if (n) setFly([n.lat!, n.lng!]); };
  return <>
    <div className="card">
      <h2>Résultats de simulation</h2>
      <span className={'tag' + (res.converged ? '' : ' bad')}>{res.converged ? 'Calcul convergé (moteur OrcaNet, équivalent EPANET)' : 'Calcul non convergé'}</span>
      <div className="kpis">
        <Kpi v={fmt(Math.min(...P)) + ' m'} l="pression min" />
        <Kpi v={fmt(Math.max(...P)) + ' m'} l="pression max" />
        <Kpi v={fmt(Math.max(...V), 2) + ' m/s'} l="vitesse max" />
        <Kpi v={fmt(demand, 2) + ' L/s'} l={`demande totale · ${fmt(demand * 86.4, 0)} m³/j`} />
      </div>
      <div className="row">
        {low.length ? <span className="tag bad">{low.length} nœud(s) &lt; 20 m</span> : <span className="tag">Toutes les pressions ≥ 20 m</span>}
        {!!high.length && <span className="tag warn">{high.length} nœud(s) &gt; 80 m</span>}
        {!!fast.length && <span className="tag warn">{fast.length} conduite(s) &gt; 1,5 m/s</span>}
        {!!slow.length && <span className="tag warn">{slow.length} conduite(s) &lt; 0,1 m/s (eau stagnante)</span>}
      </div>
      {res.warnings.slice(0, 3).map((w) => <span key={w} className="muted">⚠ {w}</span>)}
    </div>
    <div className="card">
      <div className="row">
        <button className={'chip' + (view === 'noeuds' ? ' on' : '')} onClick={() => setView('noeuds')}>Nœuds ({J.length})</button>
        <button className={'chip' + (view === 'conduites' ? ' on' : '')} onClick={() => setView('conduites')}>Conduites ({pipes.length})</button>
        <span className="muted">clic = zoom sur la carte</span>
      </div>
      <div className="scroll">
        {view === 'noeuds' ? <table><thead><tr><th>Nœud</th><th>Sol (m)</th><th>Demande (L/s)</th><th>Charge (m)</th><th>Pression (m)</th></tr></thead><tbody>
          {[...J].sort((a, b) => res.nodePressure[a.id] - res.nodePressure[b.id]).map((n) => { const p = res.nodePressure[n.id]; return (
            <tr key={n.id} className="click" onClick={() => go(n.id)}><td>{n.id}</td><td>{fmt(n.coteSol ?? n.elevation)}</td><td>{fmt(res.nodeDemand[n.id] ?? 0, 2)}</td><td>{fmt(res.nodeHead[n.id])}</td>
              <td className={p < 20 ? 'bad' : p > 80 ? 'warn' : ''}>{fmt(p)}</td></tr>); })}
        </tbody></table>
        : <table><thead><tr><th>Conduite</th><th>Ø (mm)</th><th>L (m)</th><th>Débit (L/s)</th><th>Vitesse (m/s)</th><th>Perte (m/km)</th></tr></thead><tbody>
          {[...pipes].sort((a, b) => Math.abs(res.pipeVelocity[b.id]) - Math.abs(res.pipeVelocity[a.id])).map((p) => { const v = Math.abs(res.pipeVelocity[p.id]); return (
            <tr key={p.id} className="click" onClick={() => go(p.fromId)}><td>{p.id}</td><td>{p.diameter}</td><td>{fmt(p.length, 0)}</td><td>{fmt(Math.abs(res.pipeFlow[p.id]), 2)}</td>
              <td className={v > 1.5 || v < 0.1 ? 'warn' : ''}>{fmt(v, 2)}</td><td>{fmt(res.pipeUnitHL[p.id] ?? 0, 2)}</td></tr>); })}
        </tbody></table>}
      </div>
    </div>
  </>;
}

/* ─────────────── Optimiseurs (moteur propriétaire Orcadeep, distant uniquement) ─────────────── */
type Live = { p: number; value: number; feasible: boolean };
function useOpt<T = OptResult>() {
  const [st, setSt] = useState<{ busy: boolean; progress: number; result?: T; error?: string; live: Live[]; where?: string }>({ busy: false, progress: 0, live: [] });
  const w = useRef<Worker | null>(null);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => { w.current?.terminate(); stop.current?.(); }, []);
  // chaque point de progression porte la meilleure valeur courante : courbe tracée en direct
  const onMsg = (data: Record<string, any>) => {
    if ('progress' in data) setSt((s) => ({ ...s, progress: data.progress, live: data.value > 0 ? [...s.live, { p: data.progress, value: data.value, feasible: data.feasible }] : s.live }));
    else setSt((s) => ({ ...s, busy: false, progress: 1, ...data }));
  };
  // Le calcul local (Web Worker) a été retiré : le moteur d'optimisation est désormais propriétaire d'Orcadeep.
  function local(_job: Job) {
    onMsg({ error: MOTEUR_PROPRIETAIRE });
  }
  function run(objective: OptObjective, net: Net, extra?: Record<string, unknown>) {
    w.current?.terminate(); w.current = null; stop.current?.(); stop.current = null;
    setSt({ busy: true, progress: 0, live: [] });
    const job: Job = { objective, net, extra };
    // service de calcul distant si joignable, sinon message « moteur propriétaire »
    if (cluster) remoteRun(job, onMsg).then((f) => { stop.current = f; setSt((s) => ({ ...s, where: `cluster · ${cluster?.workers ?? '?'} workers` })); }).catch(() => local(job));
    else local(job);
  }
  /** Arrête le calcul en cours et efface résultat + courbe. */
  function reset() { w.current?.terminate(); w.current = null; stop.current?.(); stop.current = null; setSt({ busy: false, progress: 0, live: [] }); }
  return { ...st, run, reset };
}

function Status({ o }: { o: { busy: boolean; progress: number; error?: string; where?: string } }) {
  if (o.busy) return <><div className="bar" aria-label="progression"><i style={{ width: `${Math.max(5, o.progress * 100)}%` }} /></div>{o.where && <small className="muted">Calcul : {o.where}</small>}</>;
  return o.error ? <span className="tag bad">{o.error}</span> : null;
}

function OptView({ r, net, setNet }: { r: OptResult; net: Net; setNet: (n: Net) => void }) {
  if (r.status === 'error') return <span className="tag bad">{tx(r.message)}</span>;
  return <>
    <div className="row">
      <span className={'tag' + (r.feasible === false ? ' bad' : '')}>{r.feasible === false ? 'Contraintes non tenues' : 'Solution faisable'}</span>
      {r.bestObjective != null && <span className="muted">objectif {fmt(r.bestObjective, 0)}</span>}
    </div>
    {r.detail && <div className="muted">{tx(r.detail)}</div>}
    {!!r.report?.length && <table><thead><tr><th>Indicateur</th><th>Avant</th><th>Après</th></tr></thead><tbody>
      {r.report.map((x) => { const k = x.unit.includes('€') ? TND_PER_EUR : 1; return <tr key={x.key}><td>{x.label}</td><td>{x.before == null ? '—' : fmt(x.before * k, 2)}</td><td>{x.after == null ? '—' : fmt(x.after * k, 2)} {x.unit.replace('€', 'TND')}</td></tr>; })}
    </tbody></table>}
    {!!r.changes?.length && <table><thead><tr><th>Élément</th><th>Avant</th><th>Après</th></tr></thead><tbody>
      {r.changes.slice(0, 15).map((c) => <tr key={c.targetId + c.field}><td>{c.targetId}</td><td>{tx(c.oldValue)}</td><td>{tx(c.newValue)}</td></tr>)}
    </tbody></table>}
    {r.apply && <button className="btn primary" onClick={() => setNet(applyOptResultToNetwork(net, r.apply!))}>Appliquer au réseau</button>}
  </>;
}

function Conduites({ net, setNet, opt, lim, setLim }: Props) {
  const o = useOpt();
  const [w, setW] = useState(0); // 0 = coût seul, en TND : la courbe se lit directement
  const [start, setStart] = useState<{ cost: number; w: number; st: Stats; net: Net } | null>(null);
  const go = () => { setStart({ cost: cost(net), w, st: peakStats(net, lim), net }); o.run('sizing', net, optWith(lim, w)); };
  const after = o.result?.apply && start ? peakStats(applyOptResultToNetwork(start.net, o.result.apply), lim) : undefined;
  useEffect(() => { if (opt && opt !== optStarted && Object.keys(net.pipes).length) { optStarted = opt; go(); } }, [opt]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="card">
    <h2>Optimisation des conduites</h2>
    <span className="muted">Moteur Orcadeep : diamètres commerciaux minimisant le coût, sous contraintes de pression et de vitesse au débit de pointe (option : pénalité de temps de séjour).</span>
    <Contraintes {...({ lim, setLim } as Props)} />
    <label className="muted">Poids du temps de séjour : <b>{w}</b> {w === 0 ? '(coût seul)' : w >= 1.5 ? '(qualité prioritaire)' : ''}
      <input type="range" min={0} max={2} step={0.25} value={w} onChange={(e) => setW(+e.target.value)} style={{ width: '100%' }} /></label>
    <button className="btn primary big" disabled={o.busy || !Object.keys(net.pipes).length} onClick={go}>{o.busy ? 'Optimisation en cours…' : '⚡ Optimiser le coût'}</button>
    <Status o={o} />
    <OptLive o={o} note={`Seules les solutions qui gardent pression ≥ ${lim?.minPressure} m et vitesse ≤ ${lim?.maxVelocity} m/s comptent.`}
      {...(start?.w === 0 ? { title: 'Coût du meilleur réseau trouvé', fmtV: tnd, before: start.cost, baseLabel: 'actuel' } : { title: 'Objectif : coût + pénalité de séjour', fmtV: (v: number) => fmt(v, 0) })} />
    {start && <Rapport a={start.st} b={after} lim={lim} />}
    {o.result && <OptView r={o.result} net={net} setNet={setNet} />}
  </div>;
}

function Pompage({ net, setNet }: Props) {
  const sel = useOpt<PumpSelectionResult>();
  const sch = useOpt();
  const hasPump = Object.keys(net.pumps).length > 0;
  const r = sel.result;
  const props = r?.proposals.filter((x) => x.feasible).sort((a, b) => a.powerAtDutyKW - b.powerAtDutyKW) ?? [];
  const kwhYr = (kw: number) => kw * (r?.operatingWindowH ?? 20) * 365;
  return <>
    <div className="card">
      <h2>Choix de la pompe</h2>
      <span className="muted">Point de fonctionnement (débit de pointe, HMT) puis catalogue : rendement, NPSH, marge de hauteur.</span>
      <button className="btn primary" disabled={sel.busy || !hasPump} onClick={() => sel.run('pump-selection', net)}>{hasPump ? 'Sélectionner la pompe' : 'Ajoutez une pompe (outil ⟲)'}</button>
      <Status o={sel} />
      {r?.status === 'error' && <span className="tag bad">{r.message}</span>}
      {r?.status === 'ok' && <>
        <div className="kpis">
          <Kpi v={fmt(r.dutyFlow) + ' L/s'} l="débit de dimensionnement" />
          <Kpi v={fmt(r.dutyHead) + ' m'} l="HMT" />
        </div>
        <table><thead><tr><th>Pompe</th><th>η</th><th>kW</th><th>kWh/an</th></tr></thead><tbody>
          {props.slice(0, 5).map((x) => <tr key={x.catalogId}><td>{x.nParallel}× {x.brand} {x.model}</td><td>{fmt(x.effAtDuty * 100, 0)} %</td><td>{fmt(x.powerAtDutyKW)}</td><td>{fmt(kwhYr(x.powerAtDutyKW), 0)}</td></tr>)}
        </tbody></table>
        {props.length > 1 && <span className="tag">Économie vs pire choix faisable : {fmt(kwhYr(props.at(-1)!.powerAtDutyKW - props[0].powerAtDutyKW), 0)} kWh/an</span>}
      </>}
    </div>
    <div className="card">
      <h2>Programme de pompage</h2>
      <span className="muted">Horaires de marche sur 24 h minimisant l'énergie (tarif, niveaux des châteaux). Nécessite un château d'eau.</span>
      <button className="btn" disabled={sch.busy || !hasPump} onClick={() => sch.run('energy', net)}>Optimiser l'énergie</button>
      <Status o={sch} />
      <OptLive o={sch} title="Énergie de pompage (meilleur programme)" fmtV={(v) => fmt(v, 0) + ' kWh'} note="Seuls les programmes qui respectent les niveaux des châteaux comptent." />
      {sch.result && <OptView r={sch.result} net={net} setNet={setNet} />}
    </div>
  </>;
}

function Chlore({ net, setNet, setMarks }: Props) {
  const o = useOpt();
  const [n, setN] = useState(2);
  useEffect(() => {
    const nodes = o.result?.apply?.nodes ?? {};
    setMarks(Object.fromEntries(Object.entries(nodes).filter(([, v]) => v.chlorineSetpoint != null)
      .map(([id, v]) => [id, ['#6bb7b2', `booster ${fmt(v.chlorineSetpoint!, 2)} mg/L`]])));
  }, [o.result]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="card">
    <h2>Chloration & boosters</h2>
    <span className="muted">Où injecter et combien : chlore résiduel entre 0,2 et 1,0 mg/L partout (cible 0,5), dose minimale.</span>
    <label className="muted">Boosters maximum : <b>{n}</b><input type="range" min={0} max={6} value={n} onChange={(e) => setN(+e.target.value)} style={{ width: '100%' }} /></label>
    <button className="btn primary" disabled={o.busy || !Object.keys(net.pipes).length} onClick={() => o.run('quality-placement', net, { qualityMaxBoosters: n })}>Placer les boosters</button>
    <Status o={o} />
    <OptLive o={o} title="Objectif chlore (dose + écarts à la cible)" fmtV={(v) => fmt(v, 2)} note="Seules les solutions qui gardent le chlore entre 0,2 et 1,0 mg/L comptent." />
    {o.result && <OptView r={o.result} net={net} setNet={setNet} />}
  </div>;
}

function Contamination({ net, setNet, setMarks }: Props) {
  const o = useOpt();
  const [n, setN] = useState(3);
  useEffect(() => setMarks(Object.fromEntries((o.result?.sensors ?? []).map((id, i) => [id, ['#d8b25a', `capteur Q${i + 1}`]]))), [o.result]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="card">
    <h2>Capteurs de contamination</h2>
    <span className="muted">Alerte précoce : scénarios d'injection Monte-Carlo, capteurs placés pour détecter le plus tôt et limiter la population exposée.</span>
    <label className="muted">Nombre de capteurs : <b>{n}</b><input type="range" min={1} max={10} value={n} onChange={(e) => setN(+e.target.value)} style={{ width: '100%' }} /></label>
    <button className="btn primary" disabled={o.busy || !Object.keys(net.pipes).length} onClick={() => o.run('contam-sensors', net, { numSensors: n, contamScenarioCount: 60 })}>Placer les capteurs</button>
    <Status o={o} />
    <OptLive o={o} title="Objectif : impact d'une contamination" fmtV={(v) => fmt(v, 1)} note="Plus bas = détection plus précoce, moins de population exposée." />
    {o.result && <OptView r={o.result} net={net} setNet={setNet} />}
  </div>;
}

/* ─────────────── Jumeau numérique : capteurs de pression + fuite ─────────────── */
function Jumeau({ net, setMarks }: Props) {
  const [k, setK] = useState(3);
  const [sensors, setSensors] = useState<string[]>([]);
  const [live, setLive] = useState<{ truth: string; read: Record<string, [number, number]>; guess: { id: string; score: number }[] } | null>(null);
  const juncs = Object.values(net.nodes).filter((n) => n.type === 'junction').map((n) => n.id);

  function place() {
    try { setSensors(proposePressureSensors(net, k)); setLive(null); } catch (e) { alert((e as Error).message); }
  }
  function leak() {
    const truth = juncs[Math.floor(Math.random() * juncs.length)];
    const base = simulate(net).nodePressure, now = simulate(withLeak(net, truth, 1 + Math.random() * 3)).nodePressure;
    // flux simulé des capteurs connectés : pression de base vs mesurée (bruit ±0,05 m)
    const read = Object.fromEntries(sensors.map((s) => [s, [base[s], now[s] + (Math.random() - 0.5) * 0.1] as [number, number]]));
    const drop = Object.fromEntries(sensors.map((s) => [s, read[s][0] - read[s][1]]));
    setLive({ truth, read, guess: locateLeak(net, sensors, drop) });
  }
  useEffect(() => {
    const m: Marks = Object.fromEntries(sensors.map((s, i) => [s, ['#d8b25a', `capteur P${i + 1}`]]));
    live?.guess.forEach((g, i) => { m[g.id] = ['#ec5a61', `fuite ? #${i + 1}`]; });
    setMarks(m);
  }, [sensors, live]); // eslint-disable-line react-hooks/exhaustive-deps

  return <>
    <div className="card">
      <h2>Jumeau numérique</h2>
      <span className="muted">Capteurs de pression connectés : emplacement qui maximise la détection des fuites sur tout le réseau.</span>
      <label className="muted">Capteurs de pression : <b>{k}</b><input type="range" min={1} max={Math.max(1, Math.min(12, juncs.length))} value={k} onChange={(e) => setK(+e.target.value)} style={{ width: '100%' }} /></label>
      <button className="btn primary" disabled={juncs.length < 2} onClick={place}>Proposer les emplacements</button>
    </div>
    {!!sensors.length && <div className="card">
      <h3>Flux temps réel (simulé)</h3>
      <button className="btn" onClick={leak}>Injecter une fuite inconnue</button>
      {live && <>
        <table><thead><tr><th>Capteur</th><th>Modèle</th><th>Mesuré</th><th>Écart</th></tr></thead><tbody>
          {sensors.map((s) => { const [b, r] = live.read[s]; return <tr key={s}><td>{s}</td><td>{fmt(b, 2)}</td><td>{fmt(r, 2)}</td><td>{fmt(r - b, 2)} m</td></tr>; })}
        </tbody></table>
        <div className="row">{live.guess.map((g, i) => <span key={g.id} className={'tag' + (i ? ' warn' : ' bad')}>#{i + 1} {g.id} · {fmt(g.score * 100, 0)} %</span>)}</div>
        <span className="muted">Fuite réelle : <b>{live.truth}</b> {live.guess[0]?.id === live.truth ? '✓ localisée' : live.guess.some((g) => g.id === live.truth) ? '✓ dans le top 3' : '— ajoutez des capteurs'}</span>
      </>}
    </div>}
  </>;
}

/* ─────────────── Irrigation : stress hydrique & sécheresse ─────────────── */
type Meteo = { et0: number; rain: number; soil: number; days: number };
function Stress({ center }: Props) {
  const [crop, setCrop] = useState('tomate');
  const [m, setM] = useState<Meteo | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setErr('');
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${center[0].toFixed(3)}&longitude=${center[1].toFixed(3)}&daily=et0_fao_evapotranspiration,precipitation_sum&hourly=soil_moisture_9_to_27cm&past_days=30&forecast_days=1&timezone=auto`)
      .then((r) => r.json())
      .then((d) => {
        const sum = (a: number[]) => a.reduce((s, x) => s + (x ?? 0), 0);
        const soil = d.hourly.soil_moisture_9_to_27cm.filter((x: number | null) => x != null);
        setM({ et0: sum(d.daily.et0_fao_evapotranspiration), rain: sum(d.daily.precipitation_sum), soil: soil.at(-1) ?? 0, days: d.daily.time.length });
      })
      .catch(() => setErr('Météo indisponible'));
  }, [center[0].toFixed(2), center[1].toFixed(2)]); // eslint-disable-line react-hooks/exhaustive-deps

  const c = CULTURES_FAO56.find((x) => x.cle === crop)!;
  const etc = m ? valeurHaute(c.kcMid) * m.et0 : 0;          // besoin de la culture (mm sur la période)
  const deficit = m ? Math.max(0, etc - 0.8 * m.rain) : 0;     // pluie efficace ≈ 80 %
  const stress = m ? Math.min(1, deficit / Math.max(etc, 1)) : 0;
  const lsha = m ? (deficit / m.days) * 10000 / 86400 : 0;     // mm/j → L/s/ha (continu)
  // humidité du sol (m³/m³) : < 0,15 sec, < 0,25 modéré — seuils indicatifs pour sols limoneux
  const drought = !m ? '' : m.soil < 0.15 ? 'Sécheresse sévère' : m.soil < 0.25 ? 'Sol en déficit' : 'Sol humide';

  return <>
    <div className="card">
      <h2>Stress hydrique</h2>
      <span className="muted">Centre de la carte · 30 derniers jours (Open-Meteo, ET₀ FAO-56 Penman-Monteith).</span>
      <select value={crop} onChange={(e) => setCrop(e.target.value)} aria-label="Culture">
        {CULTURES_FAO56.map((x) => <option key={x.cle} value={x.cle}>{x.nom}</option>)}
      </select>
      {err && <span className="tag bad">{err}</span>}
      {m && <>
        <div className="kpis">
          <Kpi v={fmt(m.et0, 0) + ' mm'} l="ET₀ cumulée" />
          <Kpi v={fmt(m.rain, 0) + ' mm'} l="pluie" />
          <Kpi v={fmt(deficit, 0) + ' mm'} l={`déficit (Kc ${valeurHaute(c.kcMid)})`} />
          <Kpi v={fmt(lsha, 2) + ' L/s/ha'} l="débit fictif continu" />
        </div>
        <div className="muted">Indice de stress : <b>{fmt(stress * 100, 0)} %</b></div>
        <div className="bar"><i style={{ width: `${stress * 100}%`, background: stress > 0.6 ? 'var(--coral)' : stress > 0.3 ? 'var(--gold)' : 'var(--sage)' }} /></div>
        <span className={'tag' + (m.soil < 0.15 ? ' bad' : m.soil < 0.25 ? ' warn' : '')}>{drought} · humidité {fmt(m.soil, 2)} m³/m³</span>
      </>}
    </div>
    <div className="card">
      <h3>Santé de la végétation</h3>
      <span className="muted">La couche NDVI MODIS (NASA, 250 m, composite 8 jours) est superposée à l'image satellite : vert = végétation vigoureuse, brun = végétation stressée ou sol nu.</span>
    </div>
  </>;
}

/* ─────────────── Agent IA : cahier des charges → réseau ─────────────── */
const AGENT_STEPS = ['Intention (Claude)', 'Rues réelles (OpenStreetMap)', 'Réseau maillé + altitudes', 'Simulation hydraulique'];
function Agent({ setNet, center, setFly, mode, runSim }: Props) {
  const [spec, setSpec] = useState(mode === 'irrigation'
    ? "Périmètre irrigué de 20 ha en goutte-à-goutte (tomate), 8 bornes d'irrigation de 2 L/s, alimentées par un forage et une bâche. Pression minimale 15 m aux bornes."
    : "Desservir un quartier de 400 logements (150 L/hab/j, 5 hab/logement, coefficient de pointe 2,5) depuis un château d'eau de 500 m³. Réseau maillé, pression minimale 20 m.");
  const [step, setStep] = useState(-1);
  const [msg, setMsg] = useState('');
  const [ms, setMs] = useState(0);
  async function build() {
    const t0 = performance.now();
    setStep(0); setMsg('');
    try {
      // cluster Docker → appli de bureau (Claude) → lecture locale : la démo ne tombe jamais
      const it: Intent = await remoteIntent(spec).catch(() => window.api ? window.api.agent(spec, center) : Promise.reject()).catch(() => parseIntent(spec));
      setStep(1);
      const { net, at } = await buildFromIntent(it, center, (s) => setStep(s === 'rues' ? 1 : 2));
      setStep(3); setNet(net); setFly(at); runSim();
      setMsg(it.summary); setStep(4);
    } catch (e) { setMsg('Erreur : ' + (e as Error).message); setStep(-1); }
    setMs(performance.now() - t0);
  }
  const busy = step >= 0 && step < 4;
  return <div className="card">
    <h2>Agent IA</h2>
    <span className="muted">Décrivez le besoin : Claude en extrait l'intention (lieu, nombre de nœuds, débit de pointe), puis KizunOrca pose un réseau maillé sous les vraies rues, avec les altitudes, et le simule.</span>
    <textarea rows={6} value={spec} onChange={(e) => setSpec(e.target.value)} aria-label="Cahier des charges" />
    <button className="btn primary big" disabled={busy} onClick={build}>{busy ? 'Conception en cours…' : '✦ Concevoir le réseau'}</button>
    {step >= 0 && <ol className="steps">{AGENT_STEPS.map((t, i) => <li key={t} className={i < step ? 'done' : i === step ? 'now' : ''}>{t}</li>)}</ol>}
    {msg && <div className="muted">{msg}{step === 4 && ` · ${fmt(ms / 1000)} s`}</div>}
  </div>;
}

/* ─────────────── Démo : import EPANET surdimensionné → optimisation du coût ─────────────── */
const DEMO_AT: [number, number] = [36.8065, 10.1815];
let demoStarted = 0;
let optStarted = 0; // un clic sur « ⚡ Optimiser » = un lancement, quel que soit l'onglet qui le traite
const DEMO_NAME = 'Démo — réseau EPANET surdimensionné';
const STEPS = ['Import du fichier EPANET (.inp)', 'Simulation hydraulique du réseau existant', '⚡ Optimiser : moteur de calcul Orcadeep', 'Réseau optimisé appliqué et re-simulé'];
function Demo({ setNet, setFly, createProject, runSim, demo, projects, opt, lim, setLim }: Props) {
  const o = useOpt();
  const [base, setBase] = useState<{ net: Net; cost: number; pmax: number; vmax: number; health: number; st: Stats } | null>(null);
  const [after, setAfter] = useState<{ cost: number; pmin: number; vmax: number; health: number; st: Stats } | null>(null);

  function start() {
    const n = importInp(demoInp, DEMO_AT);
    projects.filter((x) => x.name === DEMO_NAME).forEach((x) => deleteProject(x.id)); // une seule démo dans la liste
    createProject(DEMO_NAME, n, 'potable');
    const pts = Object.values(n.nodes);
    setFly([pts.reduce((s, x) => s + x.lat!, 0) / pts.length, pts.reduce((s, x) => s + x.lng!, 0) / pts.length]); runSim();
    const r = simulate(n);
    setBase({ net: n, cost: cost(n), pmax: Math.max(...Object.values(r.nodePressure)), vmax: Math.max(...Object.values(r.pipeVelocity).map(Math.abs)), health: health(n, r).score, st: peakStats(n, lim) });
    setAfter(null); o.reset();
  }
  const optimize = () => { if (base) { setAfter(null); setBase({ ...base, st: peakStats(base.net, lim) }); o.run('sizing', base.net, optWith(lim)); } };
  useEffect(() => { if (opt && opt !== optStarted) { optStarted = opt; if (base && !o.busy) optimize(); } }, [opt]); // eslint-disable-line react-hooks/exhaustive-deps
  // un clic sur « Démo complète » = un lancement, même si l'onglet est rouvert ensuite
  useEffect(() => { if (demo && demo !== demoStarted) { demoStarted = demo; start(); } }, [demo]); // eslint-disable-line react-hooks/exhaustive-deps
  // résultat de l'optimisation → appliqué au réseau, puis recalcul
  useEffect(() => {
    if (!base || !o.result?.apply) return;
    const n = applyOptResultToNetwork(base.net, o.result.apply);
    const r = simulate(n);
    const P = Object.entries(r.nodePressure).filter(([id]) => n.nodes[id]?.type === 'junction').map(([, v]) => v);
    setNet(n);
    setAfter({ cost: cost(n), pmin: Math.min(...P), vmax: Math.max(...Object.values(r.pipeVelocity).map(Math.abs)), health: health(n, r).score, st: peakStats(n, lim) });
  }, [o.result]); // eslint-disable-line react-hooks/exhaustive-deps

  // retour au tout début : calcul arrêté, courbe et résultats effacés, réseau importé (non optimisé) remis sur la carte
  function reset() {
    o.reset();
    if (base) setNet(importInp(demoInp, DEMO_AT)); // seulement si la démo a tourné : le projet courant est alors celui de la démo
    setBase(null); setAfter(null);
  }
  const step = !base ? 0 : o.busy ? 2 : after ? 4 : 2;
  return <>
    <div className="card">
      <h2>Démo complète</h2>
      <span className="muted">Réseau EPANET posé sous les rues de la Ville Nouvelle de Tunis (OpenStreetMap), dimensionné « à la main » : vitesses ~0,1 m/s, pressions excessives. Le moteur Orcadeep cherche les diamètres commerciaux les moins chers qui respectent la pression et la vitesse au débit de pointe.</span>
      <Contraintes {...({ lim, setLim } as Props)} />
      <div className="row">
        {!base ? <button className="btn primary" onClick={start}>▶ Lancer la démo</button>
          : <button className="btn primary big" disabled={o.busy} onClick={optimize}>{o.busy ? 'Optimisation en cours…' : after ? '⚡ Ré-optimiser' : '⚡ Optimiser le coût'}</button>}
        {base && <button className="btn" onClick={reset} title="Arrêter et revenir au réseau importé, avant optimisation">⟲ Réinitialiser</button>}
      </div>
      <ol className="steps">{STEPS.map((t, i) => <li key={t} className={i < step ? 'done' : i === step ? 'now' : ''}>{t}</li>)}</ol>
      <Status o={o} />
    </div>
    {base && <div className="card">
      <h3>Coût des conduites</h3>
      <div className="kpis">
        <Kpi v={tnd(base.cost)} l="réseau importé" />
        <Kpi v={after ? tnd(after.cost) : '…'} l="après optimisation" />
        <Kpi v={after ? '−' + fmt((1 - after.cost / base.cost) * 100, 0) + ' %' : '…'} l={after ? `${tnd(base.cost - after.cost)} économisés` : 'gain'} />
        <Kpi v={after ? fmt(after.pmin) + ' m' : fmt(base.pmax) + ' m'} l={after ? 'pression min (≥ 20 m)' : 'pression max avant'} />
      </div>
      {!!o.live.length && <CostChart live={o.live} before={base.cost} after={after?.cost} busy={o.busy} done={after && o.result?.message ? tx(o.result.message) : undefined}
        title="Coût du meilleur réseau trouvé" fmtV={tnd} baseLabel="importé" note={`Seules les solutions qui gardent pression ≥ ${lim?.minPressure} m et vitesse ≤ ${lim?.maxVelocity} m/s comptent.`} />}
      <Rapport a={base.st} b={after?.st} lim={lim} />
      <div className="row"><span className="muted">Santé du réseau :</span><b>{base.health}/100</b>{after && <><span className="muted">→</span><b style={{ color: grade(after.health)[1] }}>{after.health}/100</b><span className="muted">({grade(after.health)[0]})</span></>}</div>
      {after && <span className="muted">{o.result?.execMs != null && `Convergence en ${fmt(o.result.execMs / 1000)} s · `}vitesse max {fmt(base.vmax, 2)} → {fmt(after.vmax, 2)} m/s</span>}
    </div>}
  </>;
}

/**
 * Courbe en direct, grande, posée sur la carte : meilleur réseau FAISABLE trouvé jusqu'ici (pressions ≥ 20 m).
 * Elle part du coût du réseau importé (lui-même faisable) et ne peut que descendre — lecture immédiate pour le jury.
 */
type ChartOpts = { title: string; fmtV: (v: number) => string; before?: number; after?: number; baseLabel?: string; note: string };
/** Meilleure solution FAISABLE trouvée jusqu'ici, en direct ; ne fait que descendre. Point de départ : `before` (état actuel) ou 1re solution faisable. */
function CostChart({ live, busy, done, title, fmtV, before: b0, after, baseLabel = 'départ', note }: ChartOpts & { live: Live[]; busy: boolean; done?: string }) {
  const W = 560, H = 250, L = 64, R = 96, T = 20, B = 36;
  const before = b0 ?? live.find((l) => l.feasible)?.value ?? live[0]?.value;
  if (!before) return null;
  // axe x = itérations reçues (relances comprises) : le nombre total n'est connu qu'à la convergence
  const gens = Math.max(10, live.length);
  let best = before;
  const pts = [{ g: 0, v: before }, ...live.map((l, i) => { if (l.feasible) best = Math.min(best, l.value); return { g: i + 1, v: best }; })];
  if (after != null) pts.push({ g: gens, v: after });
  const x = (g: number) => L + (g / gens) * (W - L - R), y = (v: number) => T + (1 - v / (before * 1.1)) * (H - T - B);
  const line = pts.map((q, i) => `${i ? 'L' : 'M'}${x(q.g)},${y(q.v)}`).join('');
  const end = pts[pts.length - 1];
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * before);
  return <figure className="bigchart" aria-live="polite">
    <div className="row"><b>{title}</b><span className="tag">−{fmt((1 - end.v / before) * 100, 0)} %</span>{busy && <span className="muted">optimisation en cours…</span>}</div>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} : ${fmtV(before)} → ${fmtV(end.v)}`}>
      {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="grid" /><text x={L - 8} y={y(t) + 4} textAnchor="end">{fmtV(t)}</text></g>)}
      {[0, Math.round(gens / 2), gens].map((g) => <text key={g} x={x(g)} y={H - 18} textAnchor="middle">{g}</text>)}
      <text x={(L + W - R) / 2} y={H - 2} textAnchor="middle">itérations (relances comprises)</text>
      <line x1={L} x2={W - R} y1={y(before)} y2={y(before)} className="base" />
      <text x={W - R + 6} y={y(before) + 4}>{baseLabel} {fmtV(before)}</text>
      <path d={`${line}L${x(end.g)},${y(0)}L${L},${y(0)}Z`} className="area" />
      <path d={line} className="line" />
      <circle cx={x(end.g)} cy={y(end.v)} r={6} className="pt"><title>{`${fmtV(end.v)} à l'itération ${Math.round(end.g)}`}</title></circle>
      <text x={x(end.g) + 10} y={y(end.v) - 10} className="val">{fmtV(end.v)}</text>
    </svg>
    <figcaption className="muted">{done ? <b className="conv">✓ {done}</b> : 'Arrêt automatique quand plus aucune solution meilleure n’est trouvée.'} {note}</figcaption>
  </figure>;
}
/** Courbe en direct d'un optimiseur lancé par useOpt (affichée dès le 1er point, conservée après la fin). */
function OptLive({ o, ...c }: ChartOpts & { o: { busy: boolean; live: Live[]; result?: OptResult } }) {
  if (!o.live.length) return null;
  return <CostChart live={o.live} busy={o.busy} done={!o.busy && o.result?.message ? tx(o.result.message) : undefined} {...c} />;
}
