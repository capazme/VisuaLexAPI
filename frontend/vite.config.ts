import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pre-bundle the heavy graph lib at server start so the lazy GraphCanvas import
  // never triggers a mid-session re-optimize (the "504 Outdated Optimize Dep").
  optimizeDeps: {
    include: ['@antv/g6'],
  },
  server: {
    // Hosts allowed to reach the dev server (ngrok tunnels are blocked otherwise).
    // A leading dot allows all subdomains, handy since ngrok-free URLs rotate.
    allowedHosts: ['*.ngrok-free.app', '.ngrok-free.app'],
    proxy: {
      // Python API routes (port 5000)
      '/fetch_norma_data': 'http://localhost:5000',
      '/fetch_article_text': 'http://localhost:5000',
      '/stream_article_text': 'http://localhost:5000',
      '/fetch_brocardi_info': 'http://localhost:5000',
      '/fetch_all_data': 'http://localhost:5000',
      '/fetch_tree': 'http://localhost:5000',
      '/export_pdf': 'http://localhost:5000',
      '/version': 'http://localhost:5000',
      '/health': 'http://localhost:5000',
      // Node.js backend routes (port 3001)
      '/api': 'http://localhost:3001',
    }
  }
})
