// Client du service de calcul distant (moteur propriétaire Orcadeep). Absent → l'optimisation est indisponible ; la simulation reste locale.
import type { Intent } from './intent';

const BASE = (() => { try { return localStorage.getItem('kizunorca.api') || 'http://localhost:8787'; } catch { return 'http://localhost:8787'; } })();
export type Cluster = { workers: number; queued: number; active: number; done: number } | null;
export let cluster: Cluster = null;

/** Sonde le cluster ; appelée au démarrage puis toutes les 5 s par App (badge ☁). */
export async function probe(): Promise<Cluster> {
  cluster = await fetch(BASE + '/health', { signal: AbortSignal.timeout(1500) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return cluster;
}

export async function remoteIntent(spec: string): Promise<Intent> {
  if (!cluster) throw new Error('cluster hors ligne');
  const r = await fetch(BASE + '/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ spec }) });
  if (!r.ok) throw new Error(`agent ${r.status}`);
  return r.json();
}

/** Lance une optimisation sur le cluster ; les messages ont la même forme que ceux du Web Worker (progress | result | error). */
export async function remoteRun(job: unknown, onMsg: (m: Record<string, unknown>) => void): Promise<() => void> {
  const r = await fetch(BASE + '/jobs/optimize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(job) });
  if (!r.ok) throw new Error(`gateway ${r.status}`);
  const { id } = await r.json();
  const es = new EventSource(`${BASE}/jobs/${id}/events`);
  es.onmessage = (e) => { const m = JSON.parse(e.data); onMsg(m); if ('result' in m || 'error' in m) es.close(); };
  es.onerror = () => { es.close(); onMsg({ error: 'Connexion au cluster perdue' }); };
  return () => { es.close(); fetch(`${BASE}/jobs/${id}`, { method: 'DELETE' }).catch(() => {}); };
}
