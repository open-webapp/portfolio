import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  base: '/portfolio/',
  plugins: [react(), basicSsl()],
  server: {
    https: true,
  },
})
