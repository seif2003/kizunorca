// API d'entrée du cluster : reçoit les calculs, les met en file (Redis/BullMQ), diffuse la progression en direct (SSE).
//   POST /jobs/optimize  {objective, net, extra} → {id}
//   GET  /jobs/:id/events  flux SSE : {progress,value,feasible}… puis {result} | {error}
//   GET  /jobs/:id  état · DELETE /jobs/:id  annulation
//   POST /agent {spec} → intention (relayé au service agent)
//   GET  /health  {workers, queued, active, done} · GET /metrics (format Prometheus)
import http from 'node:http';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

const REDIS = process.env.REDIS_URL ?? 'redis://localhost:6379';
const AGENT = process.env.AGENT_URL ?? 'http://localhost:8081';
const MAX_BODY = 20e6; // un réseau de plusieurs milliers de conduites tient largement
const connection = { url: REDIS, maxRetriesPerRequest: null };
const queue = new Queue('optimize', { connection });
const redis = new Redis(REDIS);

async function stats() {
  const [c, workers] = await Promise.all([queue.getJobCounts('waiting', 'active', 'completed', 'failed'), queue.getWorkers()]);
  return { workers: workers.length, queued: c.waiting, active: c.active, done: c.completed, failed: c.failed };
}

function body(req: http.IncomingMessage): Promise<any> {
  return new Promise((ok, ko) => {
    let n = 0; const parts: Buffer[] = [];
    req.on('data', (b: Buffer) => { n += b.length; if (n > MAX_BODY) { ko(new Error('corps trop gros')); req.destroy(); } else parts.push(b); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(parts).toString() || '{}')); } catch { ko(new Error('JSON invalide')); } });
  });
}

const server = http.createServer(async (req, res) => {
  // appli de bureau / Vite en local : CORS ouvert ; le port n'est publié que sur 127.0.0.1 (docker-compose.yml)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.end();
  const send = (code: number, x: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(x)); };
  const url = new URL(req.url ?? '/', 'http://x');
  const m = url.pathname.match(/^\/jobs\/([\w-]+)(\/events)?$/);
  try {
    if (req.method === 'GET' && url.pathname === '/health') return send(200, await stats());
    if (req.method === 'GET' && url.pathname === '/metrics') {
      const s = await stats();
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      return res.end(Object.entries(s).map(([k, v]) => `kizunorca_${k} ${v}`).join('\n') + '\n');
    }
    if (req.method === 'POST' && url.pathname === '/jobs/optimize') {
      const job = await body(req);
      if (typeof job?.objective !== 'string' || typeof job?.net?.pipes !== 'object') return send(400, { error: 'objective et net requis' });
      const j = await queue.add('optimize', job, { removeOnComplete: { age: 3600 }, removeOnFail: { age: 3600 } });
      return send(202, { id: j.id });
    }
    if (req.method === 'POST' && url.pathname === '/agent') {
      const r = await fetch(AGENT + '/intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await body(req)) });
      return send(r.status, await r.json());
    }
    if (m && !m[2] && req.method === 'GET') {
      const j = await queue.getJob(m[1]);
      return j ? send(200, { id: j.id, state: await j.getState(), progress: j.progress }) : send(404, { error: 'inconnu' });
    }
    if (m && !m[2] && req.method === 'DELETE') {
      await redis.set(`cancel:${m[1]}`, '1', 'EX', 3600); // lu par l'optimiseur entre deux itérations
      const j = await queue.getJob(m[1]);
      if (j && (await j.getState()) === 'waiting') await j.remove();
      return send(200, { ok: true });
    }
    if (m && m[2] && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const ch = `ev:${m[1]}`, sub = new Redis(REDIS);
      let last = 0; // rejoue ce qui a déjà été publié (client arrivé en retard), puis suit en direct sans doublon
      const push = (raw: string) => { res.write(`data: ${raw}\n\n`); };
      sub.on('message', (_c, raw) => { const [i, data] = [raw.indexOf('|'), raw]; const n = +data.slice(0, i); if (n >= last) { last = n + 1; push(data.slice(i + 1)); } });
      await sub.subscribe(ch);
      for (const raw of await redis.lrange(ch, 0, -1)) { const i = raw.indexOf('|'); const n = +raw.slice(0, i); if (n >= last) { last = n + 1; push(raw.slice(i + 1)); } }
      req.on('close', () => { sub.disconnect(); });
      return;
    }
    send(404, { error: 'route inconnue' });
  } catch (e) {
    send(500, { error: (e as Error).message });
  }
});
server.listen(+(process.env.PORT ?? 8080), () => console.log('gateway prête sur', process.env.PORT ?? 8080));
