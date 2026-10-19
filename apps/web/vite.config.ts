import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const envDir = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, '');
  const port = Number(process.env.WEB_PORT ?? env.WEB_PORT ?? 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Invalid environment variable: WEB_PORT');
  }
  return {
    plugins: [react()],
    envDir,
    server: { host: '0.0.0.0', port, strictPort: true },
    preview: { port: 4173, strictPort: true },
  };
});
