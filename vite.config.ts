import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import electron from 'electron';

// Bibliothèques de calcul Orcadeep (propriétaires, non publiques) : résolues depuis le dossier voisin, jamais copiées ici.
const pk = fileURLToPath(new URL('../orcanet/packages/', import.meta.url));

export default defineConfig({
  base: './',
  resolve: {
    alias: [
      { find: /^@orcanet\/engine-core$/, replacement: pk + 'engine-core/src/index.ts' },
      { find: /^@orcanet\/(contracts|engine-core)\//, replacement: pk + '$1/src/' },
    ],
  },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true, fs: { allow: ['..'] } },
  plugins: [
    react(),
    {
      name: 'electron-dev',
      apply: 'serve',
      configureServer(s) {
        s.httpServer?.once('listening', () => {
          // ELECTRON_RUN_AS_NODE (posé par VS Code, lui-même Electron) ferait démarrer Electron en simple Node
          const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;
          spawn(electron as unknown as string, ['.'], { stdio: 'inherit', env: { ...env, DEV_URL: 'http://localhost:5173' } })
            .on('exit', () => process.exit());
        });
      },
    },
  ],
});
