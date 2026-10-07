import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // Écoute sur toutes les interfaces : l'app est joignable depuis le réseau local (http://<IP-du-poste>:5173).
  server: { host: true },
})
