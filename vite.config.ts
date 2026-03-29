import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  root: 'src/renderer',
  base: './',
  build: {
    outDir: '../../dist-renderer',
    sourcemap: true
  },
  server: {
    port: 5173
  }
})
