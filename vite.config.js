import { defineConfig } from 'vite';

export default defineConfig({
  base: '/Trading-app/', // Base path matches the GitHub Pages repository name
  build: {
    outDir: 'dist'
  }
});
