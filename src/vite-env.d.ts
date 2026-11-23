import type { ContentHubEnv } from './api/config'

declare global {
  // 与 API 配置共享类型，包括 WF2/WF3 的构建期 Webhook URL。
  interface ImportMetaEnv extends ContentHubEnv {}
}
