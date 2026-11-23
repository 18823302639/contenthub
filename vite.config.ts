import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { ContentHubEnv } from './src/api/config'

// 按完整变量名选取客户端所需的公开配置。
const clientEnvKeys = {
  VITE_USE_MOCK: true,
  VITE_NOCODB_API_URL: true,
  VITE_N8N_WEBHOOK_BASE_URL: true,
  VITE_WF2_GENERATE_WEBHOOK_URL: true,
  VITE_WF3_RENDER_WEBHOOK_URL: true,
  VITE_NOCODB_RSS_SOURCES_TABLE_ID: true,
  VITE_NOCODB_RSS_SYNC_SETTINGS_TABLE_ID: true,
  VITE_NOCODB_RSS_SYNC_SETTINGS_RECORD_ID: true,
  VITE_NOCODB_PRODUCTION_POOL_TABLE_ID: true,
  VITE_NOCODB_RADAR_POOL_TABLE_ID: true,
  VITE_NOCODB_ACCOUNT_METRICS_TABLE_ID: true,
  VITE_NOCODB_POST_METRICS_TABLE_ID: true,
  VITE_NOCODB_ID_FIELD: true,
} satisfies Record<keyof ContentHubEnv, true>

export default defineConfig(({ mode }) => {
  const envDir = process.env.CONTENTHUB_BUILD_ENV_DIR ?? process.cwd()
  const keys = Object.keys(clientEnvKeys)
  const rawEnv = loadEnv(mode, envDir, keys)
  const publicEnv = Object.fromEntries(keys.map((key) => [key, rawEnv[key]]))

  return {
    base: './',
    envDir,
    envPrefix: [],
    define: { __CONTENTHUB_ENV__: JSON.stringify(publicEnv) },
    plugins: [react(), tailwindcss()],
  }
})
