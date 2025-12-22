import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
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
