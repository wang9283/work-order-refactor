import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@contracts': fileURLToPath(new URL('./packages/contracts/src', import.meta.url)),
      '@next': fileURLToPath(new URL('./src/next', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        admin: fileURLToPath(new URL('./index.html', import.meta.url)),
        mobile: fileURLToPath(new URL('./app.html', import.meta.url)),
      },
    },
  },
  server: {
    host: '0.0.0.0',
    // 端口可通过环境变量覆盖，避免与同机的其他项目（如 Feed 原型）撞车后被误认为是本项目
    port: Number(process.env.WEB_PORT) || 5174,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.API_PORT || 3000}`,
    },
  },
})
