import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.join(__dirname, 'src/renderer/app'),
  base: './',
  build: {
    outDir: path.join(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: path.join(__dirname, 'src/renderer/app/index.html'),
    },
  },
  server: {
    // 5273 — dedicated port for the desktop-app renderer. The Vite default
    // 5173 is owned by internal-dashboard; 3000 by web-app's dev server.
    port: 5273,
    strictPort: true,
  },
});
