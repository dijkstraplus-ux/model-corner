import path from 'node:path';
import { defineConfig } from 'vite';
import simPlugin from './model-corner-design/sim/vite-plugin.mjs';

// The space's main page is 鲸巷, the model-corner town demo (model-corner-design/demo2: index.html + assets/).
// Only that directory is served: the rest of the workspace holds the relay token.
// The characters' life runs in model-corner-design/sim (started by the plugin below, listening on 127.0.0.1:5174);
// the page reaches it only through the /api proxy.
const site = path.resolve(import.meta.dirname, 'model-corner-design/demo2');
const SIM_PORT = 5174;

export default defineConfig({
  root: site,
  publicDir: false,
  appType: 'mpa', // unknown paths are 404s, not a fallback page
  cacheDir: path.resolve(import.meta.dirname, 'node_modules/.vite'),
  plugins: [simPlugin({ dir: path.resolve(import.meta.dirname, 'model-corner-design/sim'), port: SIM_PORT })],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${SIM_PORT}` },
    fs: { strict: true, allow: [site], deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/mira_token'] },
  },
});
