import type { ContentHubEnv } from './api/config'

declare global {
  // 与 API 配置共享类型，Webhook 与 NocoDB 仅接受公开的代理路径和标识符。
  const __CONTENTHUB_ENV__: ContentHubEnv
}
