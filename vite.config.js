import { defineConfig } from 'vite';
import { exec } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  server: {
    port: 5174,
    host: true
  },
  build: {
    outDir: 'dist'
  },
  plugins: [
    {
      name: 'analytics-sync-endpoint',
      configureServer(server) {
        server.middlewares.use('/api/sync-analytics', (req, res) => {
          if (req.method === 'POST' || req.method === 'GET') {
            const scriptPath = path.resolve(__dirname, 'scripts/sync-ga4.js');
            exec(`node "${scriptPath}"`, (err, stdout, stderr) => {
              if (err) {
                console.warn("[Vite GA4 Sync] Warning:", stderr || err.message);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: err.message }));
                return;
              }
              console.log("[Vite GA4 Sync] Executed successfully:", stdout.trim().split('\n').slice(-2).join(' '));
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'GA4 telemetry synchronized successfully' }));
            });
          }
        });
      }
    }
  ]
});
