import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/fetch_norma_data': 'http://localhost:5000',
      '/fetch_article_text': 'http://localhost:5000',
      '/stream_article_text': 'http://localhost:5000',
      '/fetch_brocardi_info': 'http://localhost:5000',
      '/fetch_all_data': 'http://localhost:5000',
      '/fetch_tree': 'http://localhost:5000',
      '/history': 'http://localhost:5000',
      '/export_pdf': 'http://localhost:5000',
    }
  }
})
