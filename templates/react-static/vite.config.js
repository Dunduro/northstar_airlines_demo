import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Hashed file names (Vite's default) let CloudFront cache assets forever; only index.html is
// revalidated (build-static.yml sets the cache headers).
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
});
