const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { Anthropic } = require('@anthropic-ai/sdk');

// Données de l'appli (projets enregistrés) : on garde le dossier d'avant le renommage KizunAqua → KizunOrca.
app.setPath('userData', path.join(app.getPath('appData'), 'kizunaqua'));

// .env à la racine du projet (dev) ou à côté de l'exécutable (portable).
for (const p of [path.join(__dirname, '..', '.env'), path.join(path.dirname(app.getPath('exe')), '.env')]) {
  try { process.loadEnvFile(p); break; } catch {}
}

// Agent rapide : Claude ne rend que l'INTENTION (~100 jetons) ; le réseau est construit sur les rues OSM par src/intent.ts.
const INTENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['place', 'n_nodes', 'demand_lps', 'head_m', 'summary'],
  properties: { place: { type: 'string' }, n_nodes: { type: 'integer' }, demand_lps: { type: 'number' }, head_m: { type: 'number' }, summary: { type: 'string' } },
};
const SYSTEM = `Tu es un ingénieur hydraulicien. Lis le cahier des charges et rends seulement l'intention de conception :
place = ville ou quartier explicitement nommé (sinon ""), n_nodes = nombre de nœuds du réseau (30 à 150, ~1 nœud par carrefour desservi),
demand_lps = débit total de pointe en L/s (population × dotation × coefficient de pointe / 86 400 si besoin), head_m = hauteur du château d'eau au-dessus du sol (défaut 45),
summary = 2 phrases en français qui résument le réseau.`;

ipcMain.handle('agent', async (_e, spec) => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY manquante dans .env');
  const res = await new Anthropic().messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 1024,
    system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: INTENT_SCHEMA } },
    messages: [{ role: 'user', content: spec }],
  });
  if (res.stop_reason === 'refusal') throw new Error('Requête refusée par le modèle.');
  const text = res.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error(`Réponse vide (${res.stop_reason}).`);
  return JSON.parse(text);
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: '#14161C', title: 'KizunOrca', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  if (process.env.DEV_URL) win.loadURL(process.env.DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
});
app.on('window-all-closed', () => app.quit());
