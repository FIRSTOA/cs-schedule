import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // 빌드 시점 타임스탬프를 코드에서 import.meta.env.VITE_BUILD_TIME로 접근 가능하게.
  // 사용자 화면에서 새 번들이 받아졌는지 즉시 확인하는 용도.
  define: {
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
  },
  server: {
    allowedHosts: true,
    host: '0.0.0.0',
  },
})
