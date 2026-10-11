// TEMPORARY, untracked: the browser pass of Studia PR C (branch API on :3014, own Vite cache). Delete after.
import { mergeConfig } from 'vite'
import base from './vite.config'

export default mergeConfig(base, {
  cacheDir: 'node_modules/.vite-studia-c',
  server: { port: 5177, strictPort: true, proxy: { '/api': 'http://localhost:3014' } },
})
