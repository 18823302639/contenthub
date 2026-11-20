import type { ContentHubEnv } from './api/config'

declare global {
  interface ImportMetaEnv extends ContentHubEnv {}
}
