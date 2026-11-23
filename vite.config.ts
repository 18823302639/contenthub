import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { ContentHubEnv } from './src/api/config'

// 仅暴露当前客户端配置所需的名称前缀。
const clientEnvPrefixes = {
  VITE_USE_MOCK: true,
  VITE_NOCODB_API_URL: true,
  VITE_NOCODB_TOKEN: true,
  VITE_N8N_WEBHOOK_BASE_URL: true,
  VITE_NOCODB_RSS_SOURCES_TABLE_ID: true,
  VITE_NOCODB_RSS_SYNC_SETTINGS_TABLE_ID: true,
  VITE_NOCODB_RSS_SYNC_SETTINGS_RECORD_ID: true,
  VITE_NOCODB_PRODUCTION_POOL_TABLE_ID: true,
  VITE_NOCODB_RADAR_POOL_TABLE_ID: true,
  VITE_NOCODB_ACCOUNT_METRICS_TABLE_ID: true,
  VITE_NOCODB_POST_METRICS_TABLE_ID: true,
  VITE_NOCODB_ID_FIELD: true,
} satisfies Record<keyof ContentHubEnv, true>

export default defineConfig({
  base: './',
  envPrefix: Object.keys(clientEnvPrefixes),
  plugins: [react(), tailwindcss()],
})
