// Local browser pass only (not committed): this branch's web app on :5181, its Python API on :5010.
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config'
const proxy = Object.fromEntries(Object.entries(base.server!.proxy!).map(([path, target]) =>
  [path, target === 'http://localhost:5000' ? 'http://127.0.0.1:5010' : target]))
export default mergeConfig({ ...base, server: { ...base.server, proxy: {} } }, defineConfig({ server: { port: 5181, strictPort: true, proxy } }))
