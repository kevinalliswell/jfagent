# 云服务器 Docker 部署指南（生产/测试通用）

> 本文是当前的**权威部署文档**，对应 2026-06-12 商业 v1（账号体系 + 导出额度 +
> 专家引擎）。旧的 `docs/deployment.md` / `docs/vps-codex-deployment-handoff.md`
> 写于 Basic Auth 种子试用阶段，其中与本文冲突的内容以本文为准。
> 文末附有一段可直接粘贴给 **Codex CLI** 的执行 Prompt，把部署的活交给它干。

## 1. 目标架构

```text
用户浏览器
  └─ HTTPS (443)
      └─ web 容器（Caddy：自动签发 Let's Encrypt 证书 + 静态前端 + 反向代理）
            └─ /api/* → api 容器（Node 24：JWT 认证、会话、引擎、导出，端口仅内网）
                  ├─ jfagent_data 卷            → SQLite（用户/额度/激活码/会话/项目）
                  ├─ jfagent_knowledge_uploads 卷 → 管理员上传的知识文件
                  └─ jfagent_output 卷           → 生成的 Word/PDF 交付文件
```

认证在**应用层**完成（邮箱+密码 → JWT；`/api/admin/*` 额外校验管理员角色），
Caddy 不再做 Basic Auth，只负责 HTTPS 与转发。

## 2. 购买服务器前的决策清单

| 项 | 建议 |
| --- | --- |
| 配置 | 2 vCPU / 4 GB 内存 / 40 GB 系统盘起步（LibreOffice 转 PDF 吃内存，2 GB 会偶发 OOM） |
| 系统 | Ubuntu 22.04 / 24.04 LTS 或 Debian 12，全新干净系统 |
| 地域与备案 | **国内服务器绑定域名走 80/443 必须先完成 ICP 备案**（周期 1~3 周）。测试期想立刻上线：选香港/新加坡等免备案地域，或暂时用 `IP:443` 自签/`IP:80` 直连（牺牲 HTTPS 自动签发） |
| 安全组/防火墙 | 只放行 22（SSH）、80、443；3000 端口**不要**对公网开放 |
| 域名 | 一个子域即可（如 `jf.example.com`），部署前把 A 记录指到服务器公网 IP 并确认生效（`ping`/`dig`） |

## 3. 需要提前准备的凭据

| 凭据 | 用途 | 没有会怎样 |
| --- | --- | --- |
| GitHub 账号 + PAT（`repo` 读权限） | 在服务器上 `git clone` 本私有仓库（路线 A） | 无法拉代码 |
| GitHub PAT（`read:packages`） | `docker login ghcr.io` 拉私有镜像（路线 B） | 只能走路线 A 本地构建 |
| OpenAI 兼容模型三件套 | `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` | 系统可用，但对话退化为模板式兜底（提取/测算/导出不受影响） |
| 管理员邮箱+强密码 | `.env.api` 的 `ADMIN_EMAIL` / `ADMIN_PASSWORD`，启动时自动创建管理员 | 第一个自助注册的账号会成为管理员（不可控，不建议） |

## 4. 镜像来源二选一

- **路线 A：服务器本地构建（首次部署推荐）** —— `git clone` 后
  `docker compose -f compose.seed.yml build`。不依赖 GHCR，代码改了重 build 即可。
  首次构建约 5~10 分钟（API 镜像含 LibreOffice + 中文字体，体积 ~1.5 GB，正常）。
- **路线 B：拉 GHCR 预构建镜像** —— merge 到 `main` 后 CI 自动发布
  `ghcr.io/kevinalliswell/jfagent-api:latest` 与 `jfagent-web:latest`。服务器只需
  `docker login ghcr.io` + `docker compose pull`。适合后续升级，不适合改代码调试。

## 5. 部署步骤（路线 A 完整版）

### 5.1 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
docker compose version   # 应输出 v2.x
```

### 5.2 拉代码

```bash
sudo mkdir -p /opt && cd /opt
git clone https://<GITHUB用户名>:<PAT>@github.com/kevinalliswell/jfagent.git
cd jfagent
```

### 5.3 写配置文件（密钥不要敲在命令行里，用编辑器写）

```bash
cp .env.api.example .env.api
cp .env.caddy.example .env.caddy
vim .env.api     # 见下方必填项
vim .env.caddy   # DOMAIN=你的域名
```

`.env.api` 必填/强烈建议：

```ini
OPENAI_BASE_URL=https://xingwan.store/v1     # 或你的中转地址
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=与中转后台一致的模型名
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=一个强密码
REGISTRATION_MODE=open                        # 测试期 open；正式售卖可改 closed
FREE_EXPORT_CREDITS=1
JWT_SECRET=openssl rand -hex 32 生成一个长随机串
```

> `AUTH_DISABLED` 在线上**必须保持未设置**。`JWT_SECRET` 不填也能跑（首启自动
> 生成并存库），但显式设置便于将来多副本/迁移。

### 5.4 构建并启动

```bash
docker compose -f compose.seed.yml build
docker compose -f compose.seed.yml up -d
docker compose -f compose.seed.yml ps        # 两个服务都应为 running
docker compose -f compose.seed.yml logs -f api   # 看到 listening 即可 Ctrl-C
```

### 5.5 部署验收清单（逐条过）

```bash
# 1) API 健康 + 认证已开启
curl -s https://<域名>/api/health
#    期望: {"ok":true,...,"auth_required":true}

# 2) 未带 token 访问受保护接口应 401
curl -s -o /dev/null -w "%{http_code}\n" https://<域名>/api/projects   # 期望 401
```

浏览器侧：

3. 打开 `https://<域名>` → 出现登录页；用 `ADMIN_EMAIL/ADMIN_PASSWORD` 登录成功。
4. 新建项目，发一句：`某医院老机房改造，50平，3楼，10个机柜，UPS后备2小时，预算30万`
   → 看板字段被提取、出现 P0 承重风险、右栏出现测算与"内部参考估算"区间。
   若回复像真人售前（而非模板句式），说明 LLM 通了；同时 `?admin=1` 侧栏
   "模型状态"应显示已连接。
5. 点"整理交付稿"→ 先看免费预览稿：**应下载到真实 PDF（带红色"预览版"横幅，
   中文显示正常）**；再确认生成正式稿 → 下载 `.docx` 用 Word/WPS 打开核对。
6. 打开 `https://<域名>/?admin=1`（管理员身份）→ 上传一份 md/docx 知识文件，
   提示重建完成；激活码面板生成 1 个码。
7. 退出，注册一个普通用户 → 有 1 份免费额度；导出消耗后再导出弹"额度不足"，
   输入刚才的激活码 → 兑换成功并完成导出。**这一步走通 = 商业闭环可用。**

### 5.6 路线 B 差异（GHCR 镜像）

```bash
echo "<read:packages 的 PAT>" | docker login ghcr.io -u <GITHUB用户名> --password-stdin
cd /opt/jfagent
docker compose -f compose.seed.yml pull
docker compose -f compose.seed.yml up -d
```

> 注意：GHCR `latest` 跟随 `main` 分支。功能分支上的改动需要先合并 PR 才会出现在
> 镜像里；着急验证未合并代码就用路线 A 本地 build。

## 6. 日常运维

### 升级

```bash
cd /opt/jfagent && git pull               # 路线 A
docker compose -f compose.seed.yml build  # 路线 B 改为 pull
docker compose -f compose.seed.yml up -d
```

数据全部在命名卷里（`jfagent_data` / `jfagent_knowledge_uploads` /
`jfagent_output`），换镜像不丢账号、额度、项目和上传文件。

### 备份（建议 cron 每日一次）

```bash
BACKUP_DIR=/opt/backups/$(date +%F) && mkdir -p "$BACKUP_DIR"
for v in jfagent_data jfagent_knowledge_uploads jfagent_output; do
  docker run --rm -v "$v":/from -v "$BACKUP_DIR":/to alpine \
    tar czf "/to/$v.tar.gz" -C /from .
done
```

恢复：同样方式 `tar xzf` 回卷后 `up -d`。

### 日志

```bash
docker compose -f compose.seed.yml logs -f api    # 业务/LLM 调用
docker compose -f compose.seed.yml logs -f web    # Caddy 证书与访问
```

## 7. 故障排查速查

| 症状 | 大概率原因与处理 |
| --- | --- |
| 浏览器打不开 / 证书签发失败 | DNS 未生效、安全组没开 80/443、国内服务器未备案被运营商拦 80/443。`docker compose logs web` 看 ACME 报错 |
| `/api/health` 通但登录后接口 401 | 改过 `JWT_SECRET` 导致旧 token 失效——属正常，重新登录即可 |
| 对话总是模板式兜底 | `.env.api` 模型三件套没配对。登录管理员开 `?admin=1` 看"模型状态"；`logs api` 里有 provider 报错原文（`fallback_reason`） |
| 预览不是 PDF / PDF 中文是方框 | 用的旧镜像（不含 LibreOffice/中文字体）。重新 `build`/`pull` 本版本镜像 |
| 上传知识后检索没变化 | 看 `logs api` 中 kb 重建是否报错；上传仅支持 md/txt/docx/pdf/xlsx/csv/tsv，单文件 ≤20MB |
| 改了 `.env.api` 不生效 | `docker compose up -d` 只在配置变化时重建；保险起见 `docker compose -f compose.seed.yml up -d --force-recreate api` |

## 8. 安全清单（上线前最后过一遍）

- [ ] `AUTH_DISABLED` 未设置；`ADMIN_PASSWORD` 为强密码且未出现在 shell history
- [ ] `JWT_SECRET` 已设为长随机串
- [ ] 测试结束对外售卖前，评估把 `REGISTRATION_MODE` 改为 `closed`（防陌生人薅 LLM 额度）
- [ ] 安全组仅开 22/80/443；SSH 建议改密钥登录
- [ ] 备份 cron 已配置并验证过一次恢复
- [ ] `.env.api` / `.env.caddy` 权限 `chmod 600`

---

## 9. 交给 Codex CLI 干的部署 Prompt

在服务器上装好 Codex CLI 并 `cd /opt`（或任意工作目录）后，把下面整段粘给它。
**先把 `【】` 占位符替换成真实值**；密钥类占位符也可以先写
`见 /root/secrets.txt`，再把真实值放进那个文件，避免进 shell 历史。

```text
你是这台云服务器上的部署工程师。目标：把 GitHub 私有仓库
kevinalliswell/jfagent（机房售前智能体，Docker Compose 架构）部署为生产服务并
完成验收。整个过程参照仓库内 docs/cloud-deployment-guide.md（权威部署文档），
按其第 5 节步骤执行、第 5.5 节清单验收、第 8 节安全清单收尾。

给定输入：
- 域名：【jf.example.com】（A 记录已指向本机公网 IP）
- GitHub 用户名：【kevinalliswell】；PAT（repo 读权限）：【粘贴或写明文件位置】
- 模型配置：OPENAI_BASE_URL=【https://xingwan.store/v1】、
  OPENAI_API_KEY=【sk-xxx】、OPENAI_MODEL=【模型名】
- 管理员账号：ADMIN_EMAIL=【you@example.com】、ADMIN_PASSWORD=【强密码】
- 注册模式：REGISTRATION_MODE=【open】，FREE_EXPORT_CREDITS=【1】
- 镜像来源：【路线 A 本地构建 / 路线 B GHCR（另给 read:packages PAT）】

执行要求：
1. 安装 Docker（若未装），clone 仓库到 /opt/jfagent。
2. 用编辑器或 heredoc 写 .env.api 与 .env.caddy（按指南 5.3 的必填项；
   JWT_SECRET 用 openssl rand -hex 32 生成），文件 chmod 600。
3. docker compose -f compose.seed.yml build && up -d。
4. 逐条执行指南 5.5 验收清单的 curl 检查（第 1、2 条），并对第 3~7 条中
   能用 curl 模拟的部分做 API 级验证：注册管理员登录拿 token、POST 一条
   chat 验证字段提取与风险触发、free_preview 导出应返回
   mime application/pdf、admin 生成激活码、注册普通用户走
   兑换→正式导出闭环。把每条结果（HTTP 状态码 + 关键字段）记录下来。
5. 配置每日备份 cron（指南第 6 节脚本）。
6. 过一遍第 8 节安全清单并逐项打勾。

硬性约束：
- 不修改任何业务代码与 compose 文件；只创建/修改 .env.api、.env.caddy 和
  cron。发现疑似代码 bug 就记录到报告里，不要自行改代码。
- 任何密钥不得回显到日志或最终报告中（用 *** 替代）。
- 遇到外部阻塞（DNS 未生效、80/443 被拦疑似未备案、PAT 权限不足）时停下来，
  在报告中说明阻塞点和需要我做的动作，不要反复硬试。
- 全程幂等：脚本/命令重复执行不应造成破坏。

完成后输出一份部署报告：服务器信息、所选路线、每条验收项的结果与证据、
backup cron 内容、安全清单勾选情况、遗留问题清单。
```

> 提示：Claude Code CLI 同样能执行这段 Prompt，开头身份句不用改。
