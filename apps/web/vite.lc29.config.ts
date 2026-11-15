// Solo locale (LC29): porta 5190 contro il backend già acceso su 3012. Non committare.
import base from './vite.config'
export default {
  ...base,
  server: { ...base.server, port: 5190, strictPort: true, proxy: { ...base.server!.proxy, '/api': 'http://localhost:3012' } },
}
