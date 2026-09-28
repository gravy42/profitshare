import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLEFILE=1 inlines everything into one index.html (used for the hosted demo).
// Normal builds are plain static files served from GitHub Pages at /profitshare/.
export default defineConfig({
  base: process.env.SINGLEFILE ? './' : '/profitshare/',
  plugins: process.env.SINGLEFILE ? [react(), viteSingleFile()] : [react()],
  test: { environment: 'jsdom' },
} as any);
