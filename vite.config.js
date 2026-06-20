import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Trading-App/', // Base path matches the GitHub Pages repository name
  build: {
    outDir: 'dist'
  }
});
