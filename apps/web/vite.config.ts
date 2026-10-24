import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import type { OutputBundle, OutputChunk } from 'rollup'
import react from '@vitejs/plugin-react'

/**
 * The pages loaded with their route (`src/pageCode.ts`, P1), by the address that opens them: the more specific first.
 * `pageCode.test.ts` keeps this list in step with `PAGE_CODE` and `pageCodeFor`.
 */
export const ROUTE_PAGES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['/history', ['src/components/features/history/HistoryView.tsx']],
  ['/forum/community', ['src/components/features/bulletin/ForumCommunityPage.tsx']],
  ['/documents', ['src/components/features/documents/DocumentReviewPage.tsx']],
  ['/crediti', ['src/pages/CreditsPage.tsx']],
  ['/collega-app', ['src/features/connections/ConnectAiAppPage.tsx']],
  ['/opus', ['src/components/features/planner/OpusPage.tsx', 'src/components/features/planner/OpusViews.tsx']],
]

/**
 * An address opened directly fetches its page's code beside the first chunk, not after it (P1): the build writes, for
 * each page of `ROUTE_PAGES`, its chunk and the chunks it imports that the first one does not, into a small script
 * that `index.html` loads `async`; read before the app starts, it adds a `modulepreload` for the address opened, and
 * for no other. A file, not an inline script: the ingress's Content-Security-Policy allows scripts from 'self' only
 * (as `theme-boot.js`). Its name carries its content's hash, as every asset's: an `index.html` always names the map of
 * its own build, so a map cached from an older deploy is never asked for.
 */
function routePreload(): Plugin {
  let base = '/'
  return {
    name: 'visualex-route-preload',
    apply: 'build',
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const bundle = ctx.bundle as OutputBundle | undefined
        if (!bundle) return html
        const chunks = Object.values(bundle).filter((output): output is OutputChunk => output.type === 'chunk')
        const entry = chunks.find((chunk) => chunk.isEntry)
        if (!entry) return html
        const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
        // What the first chunk loads already, never asked twice.
        const loaded = new Set<string>()
        const walk = (name: string, into: Set<string>) => {
          if (into.has(name)) return
          into.add(name)
          for (const next of byName.get(name)?.imports ?? []) walk(next, into)
        }
        walk(entry.fileName, loaded)
        const map = ROUTE_PAGES.map(([prefix, modules]) => {
          const files = new Set<string>()
          for (const module of modules) {
            const id = resolve(__dirname, module)
            const chunk = chunks.find((candidate) => candidate.moduleIds.includes(id))
            if (!chunk) throw new Error(`route-preload: no chunk holds ${module}`)
            walk(chunk.fileName, files)
          }
          return [prefix, [...files].filter((file) => !loaded.has(file))] as const
        })
        const source = `(function(){var m=${JSON.stringify(map)},p=location.pathname,b=${JSON.stringify(base)};`
          + 'for(var i=0;i<m.length;i++){var r=m[i][0];if(p===r||p.indexOf(r+"/")===0){'
          + 'for(var j=0;j<m[i][1].length;j++){var l=document.createElement("link");l.rel="modulepreload";'
          + 'l.crossOrigin="";l.href=b+m[i][1][j];document.head.appendChild(l)}return}}})();\n'
        const fileName = `assets/route-preload-${createHash('sha256').update(source).digest('hex').slice(0, 8)}.js`
        bundle[fileName] = {
          type: 'asset', fileName, name: 'route-preload.js', names: ['route-preload.js'],
          originalFileName: null, originalFileNames: [], source, needsCodeReference: false,
        }
        return [{ tag: 'script', attrs: { src: `${base}${fileName}`, async: true }, injectTo: 'head' }]
      },
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), routePreload()],
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
      '/fetch_rubriche': 'http://localhost:5000',
      '/fetch_alias_catalog': 'http://localhost:5000',
      '/fetch_decision': 'http://localhost:5000',
      '/fetch_decision_pdf': 'http://localhost:5000',
      '/search_decisions': 'http://localhost:5000',
      '/search_eu_case_law': 'http://localhost:5000',
      '/parse_query': 'http://localhost:5000',
      '/extract_citations': 'http://localhost:5000',
      '/export_pdf': 'http://localhost:5000',
      '/version': 'http://localhost:5000',
      '/health': 'http://localhost:5000',
      // Node.js backend routes (port 3001)
      '/api': 'http://localhost:3001',
    }
  }
})
