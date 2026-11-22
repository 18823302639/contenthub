# ContentHub 最终版

ContentHub 是自媒体选题与内容生产工具。包含选题看板、改稿台、RSS 信源管理和数据复盘与雷达四个视图，默认离线 Mock。阶段 6 增加 Docker 多阶段构建与 Nginx 静态分发。前端使用 React 18、TypeScript、Vite、Tailwind CSS、lucide-react、react-markdown、remark-gfm 和 Recharts。

## 用 Docker 运行

Dockerfile 使用 Node 构建 Vite 产物，最终镜像由 Nginx 提供 `dist` 静态文件。首次构建需要下载官方基础镜像和 npm 依赖。启动后默认使用 Mock，监听映射到本机回环地址。

### Windows Docker Desktop

启动 Docker Desktop，使用 Linux 容器。在下载 ZIP 的目录打开 PowerShell，执行：

```powershell
Expand-Archive -LiteralPath .\ContentHub-responsive-ui.zip -DestinationPath .\contenthub-responsive-ui
Set-Location .\contenthub-responsive-ui\ContentHub
docker build -t contenthub:mock .
docker run --rm -d --name contenthub -p 127.0.0.1:8088:80 contenthub:mock
Start-Process 'http://127.0.0.1:8088/'
```

### Linux

Docker Engine 启动后，在下载 ZIP 的目录执行：

```bash
unzip ContentHub-responsive-ui.zip -d contenthub-responsive-ui
cd contenthub-responsive-ui/ContentHub
docker build -t contenthub:mock .
docker run --rm -d --name contenthub -p 127.0.0.1:8088:80 contenthub:mock
```

浏览器打开 `http://127.0.0.1:8088/`。也可直接访问 `/#/topics`、`/#/workbench/3`、`/#/sources` 和 `/#/analytics`。若 8088 已被占用，修改映射左侧的主机端口，并使用对应地址。HashRouter 的路由片段由浏览器处理，Nginx 对缺失静态文件返回 HTTP 404。

停止容器的命令在 PowerShell 与 Linux 中相同。启动时使用了 `--rm`，停止后容器会自动移除。

```text
docker stop contenthub
```

### 容器环境变量

`VITE_*` 在构建时进入浏览器可见的产物。此 Dockerfile 固定构建 Mock，运行时的 `docker run -e` 无法切换已编译的 SPA。`.dockerignore` 排除本地环境文件、凭据、依赖、Git 和构建产物，源码 ZIP 中保留的 `.env.example` 仅供本地开发参考。真实 NocoDB 和 n8n 联调另行配置受保护的同源代理及访问控制。不要把真实令牌放入构建参数、镜像或浏览器包，也不要公开暴露未保护的 Webhook。 [Vite 构建期变量说明](https://vite.dev/guide/env-and-mode)

## 初始化与启动

要求 Node.js 22.13+（22 系列）或 24+，以及 npm。源码包包含锁文件。

```bash
unzip ContentHub-responsive-ui.zip
cd ContentHub
cp .env.example .env.local
npm ci --no-audit --no-fund
npm run dev -- --host 127.0.0.1
```

打开终端打印的地址，将进入 `#/topics`。侧栏默认标明「Mock · 离线演示」。首次安装依赖需要访问 npm 仓库，Mock 操作在浏览器内完成。

```bash
npm run typecheck
npm test
npm run build
npm run preview -- --host 127.0.0.1
```

生产构建生成 `dist/`，可直接交给静态 HTTP 服务。资源使用相对路径，HashRouter 使路由位于 `#` 之后，静态服务器只需提供入口与资源。

## 看板用法

- 可组合选择商业数据或汽车家电评测、最低评分与流程状态。筛选值写入当前哈希路由的查询参数，空结果时可一键清除。
- 卡片显示中文标题、赛道、来源、评分、合规风险、核心数据点和原文链接。安全外链仅接受 HTTP(S)，合成样本链接使用 `.invalid`。
- 对「待筛选」选题点击「确认选题」。界面先保存并回读「已确认-待核对」，然后调用一次 `fetch-and-draft`。真实模式收到回执后每 4 秒查询，最多等待 90 秒。处理期间按钮显示预计时间，读到「AI初稿完成」时显示完成。
- 保存回读异常时，先用「刷新列表」核对状态。状态已保存但 Webhook 受理未确认时，核对 n8n 执行记录，并刷新查看选题状态。刷新和轮询都只读，失败不会回滚已保存的状态。
- 「放弃」保存「已放弃」并停止该条前端轮询，已发布和已放弃的选题不提供放弃按钮。Mock 不会用较迟完成的初稿覆盖已放弃状态。真实工作流须自行校验记录状态和执行标识，以避免并发写入或重复执行。前端按一次操作控制提交次数。
- 「进入改稿台」打开 `#/workbench/:id`。在改稿台点击「返回选题看板」时，会恢复进入前的筛选。

## 改稿台用法

- 在看板选择「进入改稿台」，也可直接打开 `#/workbench/3` 查看 Mock 初稿，或打开 `#/workbench/4` 查看已有定稿。左栏可切换原文素材与 AI 事实核查清单。窄屏使用工具栏的「跳到稿件」直达当前稿件视图。
- 「AI 大纲」标签页以 Markdown 展示 `production_pool.ai_outline`。工具栏的「标杆样本」开关只写入 `is_benchmark`，回读确认后更新改稿台和看板徽章。
- 初次打开稿件时优先显示 `final_md`，定稿为空时使用 `draft_md`。空稿可直接输入。预览支持 GFM 表格和任务清单，跳过原始 HTML，远程图片显示替代文字。「复制全文」将当前编辑稿的安全 HTML 与 Markdown 写入剪贴板。浏览器拒绝富文本时会尝试复制 Markdown，也可直接点击「复制 Markdown」。
- 「保存定稿」只写入 `final_md`。保存提交后仍可继续输入，回读保留随后输入的内容。「标记为已发布」针对已经保存的定稿，仅更新 `workflow_status` 和 `published_at`。看板与改稿台按选题共用写入锁。
- 点击「AI 去味改稿」前，可留空、手填或选择快捷模板后编辑。留空会发送 `revision_note: ''`。界面先保存修改意见和「需AI润色」，确认回读后发出一次 `rewrite-draft`。真实模式受理后每 4 秒查询，最多等待 90 秒。手动刷新只读查询，同一任务沿用原轮询期限。
- 读到新增或变化的非空 `draft_md` 时，编辑区立即显示它。若流程状态先更新，则继续等待正文回写。等待期间的人工稿件可在「本地备份」恢复，离开再返回改稿台时，本次应用会话会保留新初稿和备份。需要长期保留时，请保存定稿。仅更新定稿字段的工作流仍提供「回写稿」对照。
- 读写失败或 Webhook 受理结果不明时，可刷新记录核对。刷新只读取记录。若记录仍显示「需AI润色」且没有可见结果，核对对应 n8n 执行记录。离开该选题或重载页面前，请保存需要保留的本地编辑。
- 「生成视频」默认选 16x9 和云希，可切换为 9x16 或选择云健、晓晓、晓伊。工作流按选题 ID 读取已存内容，需要带上刚编辑的正文时请先保存定稿。回执中的任务 ID 表示渲染任务已提交。收到有效签名链接后，改稿台每 6 秒探测一次视频，确认可下载后解锁「下载成品 MP4」。180 秒未确认时也会解锁，可稍后手动尝试。Mock 仅演示任务回执。

## RSS 信源管理

- 左侧选择「信源管理」进入 `#/sources`。列表按全部、生产池、雷达池筛选，显示信源名称、分组、赛道、RSS 链接及启用状态。宽屏显示表格，窄屏显示信源列表。列表中每条信源的名称和启停开关位于顶部。
- 使用开关切换启停。键盘聚焦后按空格或 Enter 即可操作。列表使用实际回读状态，当前信源保存时会阻止重复操作。启停结果未确认时先刷新核对。
- 「新增信源」打开弹窗，填写名称、完整的 HTTP(S) RSS 链接、赛道与分组，并选择是否立即启用。打开时默认沿用所选分组，全部视图中默认选生产池。表单校验链接格式，页面只管理信源记录。
- 新增结果未确认时，使用「核对列表」查询。优先根据已有回执 ID 核对，再以列表中实际读到的字段为准。若一次查询未找到记录，可稍后继续核对。同一应用实例内，同分组、同链接的待核实新增不会再次提交。可选择「新增其他信源」暂存核对并继续录入。服务明确拒绝输入时，表单保留内容，修正后可重试。关闭弹窗后仍可在页面看到后台保存结果。
- 离线 Mock 的变动保留于当前应用实例，重载页面恢复合成示例。

## 数据复盘与雷达

打开 `#/analytics`。默认展示公众号近 7 天，可在公众号、头条、B站之间切换，也可选择近 30 天。日期按 **UTC+8 自然日** 归档，两个窗口都含今天，分别从今天往前数第 7 或 30 个日期开始。录入日期写入当天 UTC+8 零点。跨午夜后刷新或再次操作页面，会按当前日期重新算窗。

- 阅读量、展现量和收益汇总已经核对的单日新增。展现量和阅读量按非负整数录入，百分数采用平台填报值。无可用数据的日子显示「—」，折线保留断点。实际填报的 0 会保留。
- 对同一平台，仅用有效 CTR 和与之对应的正展现量加权。100 次展现对应 10%、1000 次展现对应 4% 时，合并 CTR 约为 4.55%。阅读量与展现量的比值不参与 CTR 计算。
- 「录入运营数据」需要选择已发布内容、平台和日期，填该自然日的非重叠新增，不录平台累计快照。缺失项待数据齐全后填写。没有展现量可用于加权时，加权 CTR 显示为缺失。
- 同一内容 ID、平台、UTC+8 日期是一次录入的组合。保存前读取列表核对重复；在当前应用实例中，写入返回不明时只读核对。有同日记录时仍需匹配本次回执 ID 和指标，才会确认保存。无法确定旧记录日期时，先核对该内容在该平台的旧记录。Mock 存储在写入时拒绝重复。真实服务中的跨终端并发仍需数据库端唯一约束或幂等写入，前端检查不能保证该约束。
- 对纳入口径的同日同组合记录，指标完全相同只计一次，冲突整组隔离。真实模式下，当前会话通过录入且回执与回读确认的记录才计入；缺少单日新增证明的历史数据会排除，包括累计快照。当前数据契约没有持久化口径标记，重载后先前保存在真实服务的记录也归入待核对范围。
- 雷达只展示商业价值评分与信息差评分均大于等于 4 的机会，等于 4 的记录可入选。

## 源码目录

```text
ContentHub/
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── README.md
├── index.html
├── nginx.conf
├── package-lock.json
├── package.json
├── src/
│   ├── api/
│   │   ├── config.ts
│   │   ├── contracts.ts
│   │   ├── http.ts
│   │   ├── index.ts
│   │   ├── mockApi.ts
│   │   ├── mockData.ts
│   │   ├── nocodbClient.ts
│   │   ├── nocodbCodec.ts
│   │   ├── productionFilters.ts
│   │   ├── webhookClient.ts
│   │   └── workflowPolling.ts
│   ├── app/
│   │   ├── ContentHubApp.tsx
│   │   └── useRecordWrites.ts
│   ├── features/
│   │   ├── analytics/
│   │   │   ├── AddMetricDialog.tsx
│   │   │   ├── AnalyticsPage.tsx
│   │   │   ├── MetricTrends.tsx
│   │   │   ├── analytics.css
│   │   │   ├── review.ts
│   │   │   └── useAnalytics.ts
│   │   ├── sources/
│   │   │   ├── AddSourceDialog.tsx
│   │   │   ├── SourcesPage.tsx
│   │   │   ├── sourceFields.ts
│   │   │   ├── sources.css
│   │   │   └── useSources.ts
│   │   ├── topics/
│   │   │   ├── TopicCard.tsx
│   │   │   ├── TopicsPage.tsx
│   │   │   └── useTopicBoard.ts
│   │   └── workbench/
│   │       ├── MarkdownPreview.tsx
│   │       ├── WorkbenchPage.tsx
│   │       ├── useWorkbench.ts
│   │       └── workbench.css
│   ├── main.tsx
│   ├── styles.css
│   ├── types/
│   │   └── schema.ts
│   ├── utils/
│   │   ├── externalUrl.ts
│   │   └── metricDays.ts
│   └── vite-env.d.ts
├── tests/
│   ├── analytics.test.tsx
│   ├── api.test.ts
│   ├── metrics.test.ts
│   ├── sources.test.tsx
│   ├── topics.test.tsx
│   └── workbench.test.tsx
├── tsconfig.json
└── vite.config.ts
```

`node_modules/` 由 npm 安装生成，`dist/` 由构建生成。

## API 入口

浏览器代码通过 `createContentHubApi(import.meta.env)` 建立 API 实例。整个应用应共享该实例，Mock 写入与异步回写才会反映在各业务模块的读取中。所有对服务的请求集中在 `src/api/`。

| 用途 | 方法 |
| --- | --- |
| 选题列表与改稿台 | `listProductionItems({ trackTag, minScore, status })`、`getProductionItem(id)` |
| 确认、放弃、提交修改意见、保存定稿或发布 | `updateProductionItem(id, changes)` |
| 信源列表、启停和新增 | `listRssSources(poolType?)`、`setRssSourceActive(id, active)`、`createRssSource(source)` |
| 雷达机会 | `listRadarItems({ minCommercialScore, minInfoGapScore })`，两个下限均为含等号 |
| 运营数据 | `listAccountMetrics(since?)`、`createAccountMetric(metric)`，`since` 为含该时间点的下界 |
| 帖子指标，只读 | `listPostMetrics()`，读取与运营数据同名的字段 |
| AI 动作 | `triggerWebhook(action, payload)` |

列表由 API 层取得各页记录后统一筛选。运营指标中的 CTR 和完读率使用百分数，`25` 表示 25%，收入使用元。时间字段建议提供带时区的 ISO 8601 字符串。标记发布时应在同一次更新提交 `workflow_status: '已发布'` 和 `published_at`。

### 离线 Mock

`VITE_USE_MOCK=true` 或未设置时使用 Mock。普通操作约延迟 180 毫秒，写入结果可通过后续查询读到。模拟 Webhook 返回 HTTP 202 受理回执，约 900 毫秒后才更新记录。每个 API 实例独立保存内存状态，刷新恢复初始示例。信源、选题、稿件和运营数据都是合成示例，外链使用保留的 `.invalid` 域名。

确认后可模拟生成原文、核查说明与初稿。模拟润色以已有定稿或初稿为输入，并将结果写入 `draft_md`。等待期间重复触发同一选题会报错。期间人工改动同一选题时，之前排队的 Mock 任务会放弃回写，避免覆盖较新的内容或把已放弃选题改回草稿。

### 真实请求

在受控联调环境将 `VITE_USE_MOCK` 显式设为 `false`，然后重启 Vite 或重新构建。真实模式会向调用方报告配置错误、连接异常和 HTTP 失败。Table ID 的来源是 NocoDB 表菜单或表的 URL，它以 `m` 开头。PostgreSQL 表名用于识别业务表。 [NocoDB 查找 ID](https://nocodb.com/docs/apis/ids)

| 业务表 | NocoDB Table ID 配置 |
| --- | --- |
| `rss_sources` | `VITE_NOCODB_RSS_SOURCES_TABLE_ID` |
| `production_pool` | `VITE_NOCODB_PRODUCTION_POOL_TABLE_ID` |
| `radar_pool` | `VITE_NOCODB_RADAR_POOL_TABLE_ID` |
| `account_metrics` | `VITE_NOCODB_ACCOUNT_METRICS_TABLE_ID` |
| `post_metrics` | `VITE_NOCODB_POST_METRICS_TABLE_ID`，仅调用 `listPostMetrics()` 时配置 |

- NocoDB 以 `VITE_NOCODB_API_URL` 为 v2 基础地址。客户端自动发送 `xc-token`，使用 `GET /tables/{tableId}/records` 的 `offset`、`limit` 和 `pageInfo.isLastPage` 遍历记录。分页按主键排序，偏移量依返回的实际条数递增。 [NocoDB v2 数据 API](https://nocodb.com/apis/v2/data)
- 单条读取使用 `GET /tables/{tableId}/records/{id}`。`POST` 新增和 `PATCH` 更新都发送一项记录数组到记录集合。PATCH 包含主键，写入成功后按回执主键回读。NocoDB 主键显示名默认 `id`，可将 `VITE_NOCODB_ID_FIELD` 设为实际显示名，例如 `Id`。前端模型统一使用数值型 `id`。 [NocoDB v2 数据 API](https://nocodb.com/apis/v2/data)
- 读取时，未知选项保留原文本并在控制台提示。标题接受数组、JSON 数组或单条文本。缺失文本和日期为空字符串，`ai_outline` 缺失时为 `null`，无效数值按缺失处理。布尔值兼容 `true`、`false`、`1`、`0` 及其字符串。列表内无有效主键的记录会跳过，分页仍按原始条数前进。
- `post_metrics` 只读接口按同名字段兼容 `production_id`、`platform`、展现、阅读、CTR、完读率、收益和记录日期。项目没有这张表的专属列定义，同名字段以外的列需要确认实际映射后才可使用。运营页继续查询 `account_metrics`。
- n8n 以 `VITE_N8N_WEBHOOK_BASE_URL` 为基础地址，JSON body 通过 POST 发往 `${VITE_N8N_WEBHOOK_BASE_URL}/${action}`。初稿和改稿的 2xx 回执表示请求受理，完成结果通过 NocoDB 回读。视频工作流在 2xx JSON 回执中返回 `{ jobId, downloadUrl }`。`jobId` 为非空字符串，`downloadUrl` 由后端签发，单视频有效期 24 小时。缺少合法 HTTP(S) 下载链接时，改稿台仍显示有效任务 ID。 [n8n Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)

真实部署待实测项目包括 PostgreSQL 外部表在 NocoDB 中暴露的字段名和类型、主键和创建时间默认值、标题 JSON 与日期的实际序列化、单条写入回执及分页上限，以及已激活的 n8n 工作流对 payload 的解析、鉴权和写回状态。接口测试使用合成响应，未连接真实 NocoDB、n8n 和渲染机。

### 受理、完成与重试

下列 payload 是本脚手架采用的联调约定。真实 n8n 工作流应核对字段名。

| 动作 | 先保存到 NocoDB | POST body | Mock 完成后 |
| --- | --- | --- | --- |
| `fetch-and-draft` | `workflow_status: '已确认-待核对'` | `{ production_id }` | 写入原文、事实核查与初稿，状态改为「AI初稿完成」 |
| `rewrite-draft` | 本次 `revision_note` 与 `workflow_status: '需AI润色'` | `{ production_id, revision_note }`，修改意见可为空字符串 | 优先展示回写的 `draft_md`，流程就绪后状态为「待人工终审」 |
| `generate-video` | 按需保存最新定稿 | `{ production_id, format, voice }`，`format` 为 `16x9` 或 `9x16`，`voice` 为所选 Edge-TTS 音色 ID | 返回模拟 `jobId`，`downloadUrl` 为 `null` |

状态写入和 Webhook 受理是两次独立请求。先确认写入结果，再触发对应 Webhook。写入已返回成功但回执或回读异常时，API 抛出 `WriteReadbackError`，优先按可用主键查询记录。Webhook 超时、断网或响应有歧义时，先查记录和 n8n 执行历史，确认未启动后再触发。真实工作流若需要允许安全重试，应先约定执行标识与去重规则。 [n8n Webhook 响应模式](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/#respond)

### 联调权限边界

`VITE_*` 会进入浏览器产物。`VITE_NOCODB_TOKEN` 在直连时也会出现在浏览器请求中。禁止将真实长期 `xc-token` 写入任何公开或共享构建。只在隔离、受控的临时联调中使用短期、最小权限凭证。

部署环境可使用现有同源反向代理，例如将基础地址设为 `/internal/nocodb/api/v2` 和 `/internal/n8n/webhook`。若代理负责注入凭证，可让浏览器的 `VITE_NOCODB_TOKEN` 使用公开标记 `proxy-managed`。代理应在完成用户鉴权和授权后覆盖客户端发送的 `xc-token`，仅放行所需表、方法及指定的 Webhook 路径。可按现有设施选用身份网关、VPN 或内网访问控制。跨源 CORS 用于控制浏览器可读取响应的来源。身份校验、表和工作流的访问授权仍需独立配置。此方案由部署环境提供，本阶段只交付前端适配。

视频下载使用后端返回的签名地址，前端直接在新标签页打开并保留查询串原文。渲染服务地址和签名凭据由后端管理。HTTPS 部署请签发 HTTPS 下载链接。浏览器通过 `GET` 和 `Range: bytes=0-0` 检查 R2，跨域时需要存储桶的 CORS 策略允许 ContentHub 的来源和 `GET`。 [Cloudflare R2 CORS 配置](https://developers.cloudflare.com/r2/buckets/cors/#use-cors-with-a-presigned-url) [W3C 混合内容规范](https://www.w3.org/TR/mixed-content/#modifications-to-html)

阶段 6 完成 ContentHub 的离线 Mock 源码交付。
