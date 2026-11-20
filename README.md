# ContentHub 阶段 3

ContentHub 是自媒体选题与内容生产工具。阶段 3 新增改稿台，延续固定侧栏、HashRouter、选题看板及离线 Mock。前端使用 React 18、TypeScript、Vite、Tailwind CSS、lucide-react、react-markdown 和 remark-gfm。

## 初始化与启动

要求 Node.js 22.13+（22 系列）或 24+，以及 npm。源码包包含锁文件。

```bash
unzip ContentHub-stage-3.zip
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
- 对「待筛选」选题点击「确认选题」。界面先保存并回读「已确认-待核对」，然后调用一次 `fetch-and-draft`。收到受理回执后，以有限次数的单条读取查询回写，实际读到「AI初稿完成」时才显示初稿完成。
- 保存回读异常时，先用「刷新列表」核对状态。状态已保存但 Webhook 受理未确认时，核对 n8n 执行记录，并刷新查看选题状态。刷新和轮询都只读，失败不会回滚已保存的状态。
- 「放弃」保存「已放弃」并停止该条前端轮询，已发布和已放弃的选题不提供放弃按钮。Mock 不会用较迟完成的初稿覆盖已放弃状态。真实工作流须自行校验记录状态和执行标识，以避免并发写入或重复执行。前端按一次操作控制提交次数。
- 「进入改稿台」打开 `#/workbench/:id`。信源管理和运营数据入口显示后续阶段占位。

## 改稿台用法

- 在看板选择「进入改稿台」，也可直接打开 `#/workbench/3` 查看 Mock 初稿，或打开 `#/workbench/4` 查看已有定稿。左栏可切换原文素材与 AI 事实核查清单。
- 右栏优先显示 `final_md`，定稿为空时使用 `draft_md`。空稿可直接输入。预览支持 GFM 表格和任务清单，跳过原始 HTML，远程图片显示替代文字。复制对象始终是当前编辑区全文。
- 「保存定稿」只写入 `final_md`。保存提交后仍可继续输入，回读保留随后输入的内容。「标记为已发布」针对已经保存的定稿，仅更新 `workflow_status` 和 `published_at`。看板与改稿台按选题共用写入锁。
- 填写修改意见并点击「AI 去味改稿」。界面先保存 `revision_note` 与「需AI润色」，确认回读后发出一次 `rewrite-draft`。Webhook 受理后只读查询回写。若读到对应意见和「待人工终审」，改稿台才显示结果已回写。提交受理后返回看板，有限次数的查询仍可更新已打开过的看板。进入本来就处于待回写状态的记录时，改稿台也会只读跟进。
- 编辑区有未保存改动时，回写稿单独供对照。可保存当前编辑，或在「回写稿」Tab 主动选用回写稿。需要提交 AI 改稿时，先保存已有编辑。等待初稿或润色回写期间仍可编辑与复制，写入操作等流程状态更新后开放。
- 读写失败或 Webhook 受理结果不明时，可刷新记录核对。刷新只读取记录。若记录仍显示「需AI润色」且没有可见结果，核对对应 n8n 执行记录。离开该选题或重载页面前，请保存需要保留的本地编辑。

## 源码目录

```text
ContentHub/
├── .env.example
├── .gitignore
├── README.md
├── index.html
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
│   │   └── webhookClient.ts
│   ├── app/
│   │   ├── ContentHubApp.tsx
│   │   └── useRecordWrites.ts
│   ├── features/
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
│   │   └── externalUrl.ts
│   └── vite-env.d.ts
├── tests/
│   ├── api.test.ts
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
| AI 动作 | `triggerWebhook(action, payload)` |

列表由 API 层取得各页记录后统一筛选。运营指标中的 CTR 和完读率使用百分数，`25` 表示 25%，收入使用元。时间字段建议提供带时区的 ISO 8601 字符串。标记发布时应在同一次更新提交 `workflow_status: '已发布'` 和 `published_at`。

### 离线 Mock

`VITE_USE_MOCK=true` 或未设置时使用 Mock。普通操作约延迟 180 毫秒，写入结果可通过后续查询读到。模拟 Webhook 返回 HTTP 202 受理回执，约 900 毫秒后才更新记录。每个 API 实例独立保存内存状态，刷新恢复初始示例。信源、选题、稿件和运营数据都是合成示例，外链使用保留的 `.invalid` 域名。

确认后可模拟生成原文、核查说明与初稿。润色以改稿台当前显示的稿件为输入。有定稿时更新 `final_md` 并保留原初稿，定稿为空时更新 `draft_md`。等待期间重复触发同一选题会报错。期间人工改动同一选题时，之前排队的 Mock 任务会放弃回写，避免覆盖较新的内容或把已放弃选题改回草稿。

### 真实请求

在受控联调环境将 `VITE_USE_MOCK` 显式设为 `false`，然后重启 Vite 或重新构建。真实模式会向调用方报告配置错误、连接异常和 HTTP 失败。Table ID 的来源是 NocoDB 表菜单或表的 URL，它以 `m` 开头。PostgreSQL 表名用于识别业务表。 [NocoDB 查找 ID](https://nocodb.com/docs/apis/ids)

| 业务表 | NocoDB Table ID 配置 |
| --- | --- |
| `rss_sources` | `VITE_NOCODB_RSS_SOURCES_TABLE_ID` |
| `production_pool` | `VITE_NOCODB_PRODUCTION_POOL_TABLE_ID` |
| `radar_pool` | `VITE_NOCODB_RADAR_POOL_TABLE_ID` |
| `account_metrics` | `VITE_NOCODB_ACCOUNT_METRICS_TABLE_ID` |

- NocoDB 以 `VITE_NOCODB_API_URL` 为 v2 基础地址。客户端自动发送 `xc-token`，使用 `GET /tables/{tableId}/records` 的 `offset`、`limit` 和 `pageInfo.isLastPage` 遍历记录。分页按主键排序，偏移量依返回的实际条数递增。 [NocoDB v2 数据 API](https://nocodb.com/apis/v2/data)
- 单条读取使用 `GET /tables/{tableId}/records/{id}`。`POST` 新增和 `PATCH` 更新都发送一项记录数组到记录集合。PATCH 包含主键；写入成功后按回执主键回读。四表使用同一个 NocoDB 主键显示名，默认 `id`，可将 `VITE_NOCODB_ID_FIELD` 设为 `Id` 等实际显示名。前端模型统一用 `id`。 [NocoDB v2 数据 API](https://nocodb.com/apis/v2/data)
- 新建信源由存储侧生成主键和 `created_at`。运营数据的 `production_id` 应暴露为数值字段。适配器兼容真正的三元素标题数组和保存了该 JSON 数组的文本字段。可空稿件字段在前端省略，未发布的空日期映射为 `''`。
- n8n 以 `VITE_N8N_WEBHOOK_BASE_URL` 为基础地址，JSON body 通过 POST 发往 `${VITE_N8N_WEBHOOK_BASE_URL}/${action}`。此接口的回执只表示收到 HTTP 2xx，业务步骤的实际完成需要查看 NocoDB 记录。 [n8n Webhook](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/)

真实部署待实测项目包括 PostgreSQL 外部表在 NocoDB 中暴露的字段名和类型、主键和创建时间默认值、标题 JSON 与日期的实际序列化、单条写入回执及分页上限，以及已激活的 n8n 工作流对两个 payload 的解析、鉴权和写回状态。接口测试使用合成响应，未连接真实 NocoDB 和 n8n。

### 受理、完成与重试

下列 payload 是本脚手架采用的联调约定。真实 n8n 工作流应核对字段名。

| 动作 | 先保存到 NocoDB | POST body | Mock 完成后 |
| --- | --- | --- | --- |
| `fetch-and-draft` | `workflow_status: '已确认-待核对'` | `{ production_id }` | 写入原文、事实核查与初稿，状态改为「AI初稿完成」 |
| `rewrite-draft` | 本次 `revision_note` 与 `workflow_status: '需AI润色'` | `{ production_id, revision_note }` | 回写当前显示的稿件字段，状态改为「待人工终审」 |

状态写入和 Webhook 受理是两次独立请求。先确认写入结果，再触发对应 Webhook。写入已返回成功但回执或回读异常时，API 抛出 `WriteReadbackError`，优先按可用主键查询记录。Webhook 超时、断网或响应有歧义时，先查记录和 n8n 执行历史，确认未启动后再触发。真实工作流若需要允许安全重试，应先约定执行标识与去重规则。 [n8n Webhook 响应模式](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.webhook/#respond)

### 联调权限边界

`VITE_*` 会进入浏览器产物。`VITE_NOCODB_TOKEN` 在直连时也会出现在浏览器请求中。禁止将真实长期 `xc-token` 写入任何公开或共享构建。只在隔离、受控的临时联调中使用短期、最小权限凭证。

部署环境可使用现有同源反向代理，例如将基础地址设为 `/internal/nocodb/api/v2` 和 `/internal/n8n/webhook`。若代理负责注入凭证，可让浏览器的 `VITE_NOCODB_TOKEN` 使用公开标记 `proxy-managed`。代理应在完成用户鉴权和授权后覆盖客户端发送的 `xc-token`，仅放行所需表、方法及两个 Webhook 路径。可按现有设施选用身份网关、VPN 或内网访问控制。跨源 CORS 用于控制浏览器可读取响应的来源。身份校验、表和工作流的访问授权仍需独立配置。此方案由部署环境提供，本阶段只交付前端适配。

阶段 3 在此验收。阶段 4 在收到明确的「继续」后启动。
