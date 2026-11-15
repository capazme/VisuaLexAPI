// Solo locale (LC30): porta 5191 contro il backend già acceso su 3011. Non committare.
import base from './vite.config'
export default {
  ...base,
  server: { ...base.server, port: 5191, strictPort: true, proxy: { ...base.server!.proxy, '/api': 'http://localhost:3011' } },
}
