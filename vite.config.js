import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // Relative base path works on both local dev and GitHub Pages
  build: {
    outDir: 'dist'
  }
});
