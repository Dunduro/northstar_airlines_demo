import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';
const mock = process.env.MOCK_PROXY_TARGET ?? 'http://localhost:4000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/v1': api,
      '/docs': api,
      // The Notifications panel reads what the mock Teams / ServiceNow / GitHub received.
      '/mock': { target: mock, rewrite: (path) => path.replace(/^\/mock/, '') },
    },
  },
});
