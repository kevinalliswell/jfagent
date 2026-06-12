# 开发笔记 — 商业 v1 冲刺复盘（2026-06-12）

一次性把"本地 MVP"推到"可商业落地 v1"的开发记录：做了什么、为什么这么做、
踩了哪些坑、下一个接手的人（或 AI agent）应该知道什么。配合
`docs/decisions.md` D-031~D-035 与 `docs/tasks.md` T-040~T-048 阅读。

## 1. 任务与结果

Owner 指令：不受原有阶段规划限制，8 小时内完成机房售前智能体的商业落地版。

交付（单次提交 `0786949`，+4268/-432，34 文件）：

- 确定性专家引擎（UPS/制冷/电池/造价估算 + P0/P1 风险规则 + 审计日志）
- 账号体系（scrypt+JWT、角色、按用户隔离数据、引导管理员、注册开关）
- 计费闭环（导出额度 + 线下售卖激活码 + 流水审计，免支付网关）
- 多轮持久化智能体（历史入库、刷新恢复、近 12 轮回放给 LLM、引擎结果注入提示词）
- 真实 PDF 免费预览（docx→soffice→PDF 带水印横幅）+ 正式稿内部估算附录
- 知识库 11→71 块（6 份新领域资料）+ 管理面板（激活码/知识上传）
- 部署加固（SQLite 数据卷、auth 环境变量、API 镜像补 LibreOffice+中文字体）

验证：`npm run check` 全绿（19 单测含 14 个引擎规格测试）、`api:smoke`
端到端（认证/越权/额度/激活码/PDF/DOCX）、Playwright 浏览器实跑
登录→对话→风险→估算→导出。

## 2. 关键架构决策与理由

**保留技术栈，不重写。** Owner 授权可以换栈，但评估后认定原骨架健康
（React19+Vite / Node24+TS 零依赖后端 / SQLite / python-docx），缺的是商业
能力而非框架。8 小时全部投入在能力补齐上，重写的风险是交不了付。

**管线式智能体，不做自主工具循环。** 每条消息走固定编排：确定性提取 →
检索 → 引擎测算 → LLM 生成回复与低优先级字段候选。工程数字与风险判定必须
确定性可审计——LLM 可以解释引擎输出，但被明确禁止调低容量或淡化风险
（提示词约束 + 后端 `llmProtectedSources` 源优先级双保险）。这是产品立场，
不是技术妥协。

**激活码而非支付网关。** 微信/支付宝商户号需要资质与周期，而"管理员生成
一次性激活码→线下收款→用户应用内兑换额度"当天就能收钱，且全程有
`credit_transactions` 流水。支付网关留给量起来之后。

**Mock 模式降级为纯演示。** 之前 mock 与 backend 双实现追求行为对等，是仓库
最大的维护负担。本次明确：新能力（认证/额度/引擎估算/消息持久化）不进
mock，差异表记录在 `docs/architecture.md`。共享语义只保留风险 ID、FSM 推导、
关键文案，并有测试钉住。

**手写 JWT/scrypt 而非引库。** 后端坚持零运行时依赖（连 express 都没有），
`node:crypto` 的 scrypt+HMAC 足够当前规模，少一棵依赖树就少一类供应链问题。

## 3. 踩过的坑（按疼痛程度排序）

1. **中文数量词正则缺陷**："12个机柜"中"个"导致 `(\d+)\s*机柜` 失配，回退
   窗口匹配抓到了"1楼"的 1，机柜数提取成 1，UPS 测算整体跑偏。修复：数字与
   关键词之间允许量词 `[个台套位]?`。教训：中文抽取正则必须用真实口语句式
   测，不能只测规整句；E2E 阶段才暴露说明单测语料太"干净"。
2. **compose 缺数据卷**：`data/jfagent.sqlite` 没挂卷，镜像升级=丢全部账号
   与额度数据。商业化后这是事故级缺陷。教训：凡是"从演示转生产"的项目，
   第一件事盘点所有落盘路径与卷映射。
3. **Docker 镜像与代码能力脱节**：代码实现了 soffice 转 PDF，但
   `api.Dockerfile` 根本没装 LibreOffice，且无中文字体（PDF 会出方框）。
   本地 `setup-env.sh` 装了所以一直绿。教训：宿主环境与容器环境的依赖清单
   要分别核对，"本地能跑"证明不了镜像能跑。
4. **soffice 单实例冲突**：API 进程调用 soffice 期间，宿主机手动再起 soffice
   会 "source file could not be loaded"。用 `-env:UserInstallation` 隔离
   profile 也不完全可靠。当前并发量无碍；将来导出并发上来需要队列化。
5. **同名按钮导致 E2E 误点**：快捷回复 chip 与导出按钮都叫"整理交付稿"，
   Playwright `getByText().first()` 点到了 chip。用类选择器解决。教训：
   E2E 选择器优先用语义类名/testid，文案会撞车。
6. **smoke 进程内翻转环境变量**：认证开关 `isAuthDisabled()` 每请求读 env，
   所以 smoke 能在同一进程内先跑无认证旧链路、再翻转 env 跑完整认证流。
   这是刻意设计——如果模块加载时缓存了开关，测试就得多起一个进程。

## 4. 验证方法论（这套打法值得复用）

四层金字塔，每层抓不同的回归：

1. **纯函数单测**（`tests/rulesEngine.test.ts`）：直接对照规格文档的
   Test Matrix 写断言，规格即用例。
2. **进程内 smoke**（`server/smoke.ts`）：HTTP 层全链路，含 401/403/409/402
   等失败路径、跨用户越权、重启恢复（真的拉起子进程二次验证持久化）。
   失败路径的断言数量应当不少于成功路径。
3. **浏览器 E2E**（Playwright 手跑）：发现了单测永远发现不了的两个问题
   （量词 bug 的真实触发句、同名按钮）。
4. **产物内容断言**：解包 DOCX 的 document.xml 检查"内部参考估算/风险清单/
   七氟丙烷"等标记词是否真的渲染了——文档生成类功能必须验内容，不能只验
   "文件存在且能打开"。

另外：改完所有东西后用 `npm run format` 统一格式再跑 `check`，避免
prettier 报错噪音打断心流。

## 5. 给下一个接手者的地图

- **改会话/字段/风险/导出语义** → 动 `server/sessionService.ts` 时检查
  `docs/architecture.md` 的 mock 差异表要不要加行；共享文案被
  `tests/presalesCockpit.test.ts` 钉住。
- **改引擎参数**（默认值/价格表/目录档位）→ 全在 `server/rulesEngine.ts`
  顶部的 `ENGINE_DEFAULTS` / `REFERENCE_PRICES` / 两个 catalog 常量；改完
  必跑 `tests/rulesEngine.test.ts`（有金额区间断言，价格大改会触发，属预期，
  同步更新断言区间即可）。参考价建议每季度对照
  `knowledge/机房设备参考价格表.csv` 校一次。
- **改导出文档** → payload 在 `server/exportPayload.ts`，渲染在
  `scripts/render-export-docx.py`；smoke 的 DOCX 内容断言和
  `audit_docx()` 的标记检查要同步。
- **额度/激活码语义**：管理员导出不扣额度但仍走确认弹窗；预览永远免费且
  不改变 `export_status`；所有变动必须写 `credit_transactions`。
- **认证边界**：资产下载是无鉴权的 capability URL（UUID 不可猜），为的是
  `<a href>` 直接能下；如果将来要求更严，需要带签名时效的下载票据。
- **AUTH_DISABLED=1** 是单机自用模式（合成 local_admin），线上严禁。
- 生成文件（`*generatedKnowledge*`、`server-dist/`、`output/`）全部
  gitignored，永远不要手改。

## 6. 已知边界与建议路线

未做（刻意，记录在 GOAL.md 非目标）：在线支付、真实 embedding/向量库、
流式输出、组织级多租户、OCR、会话内文件解析（`message_type:"file"` 通道
已预留，缺前端入口与解析管线）。

建议顺序（等第一批真实用户用完再定）：
① 流式输出（体感收益最大）→ ② 会话内拖文件解析进字段 → ③ LLM function
calling 自主决定查库/重算 → ④ 支付网关。

最大的单点风险仍是 LLM 供应商（中转站稳定性）：`fallback_reason` 已经把
每次降级原因记进 `agent_runtime`，运营期盯住它就能量化供应商质量。
