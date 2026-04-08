# CFSeededOptimizer

正式项目名：CFSeededOptimizer。

这是一个面向 Loon 手机端的 Cloudflare 种子优选项目。GitHub 负责收集和维护候选 IP 池，Loon 负责最终优选、兜底、Gist 写入和低打扰通知。

## 项目目标

- 把重活尽量放到 GitHub Actions
- 手机端只保留最终拍板所需的少量测速
- 让 Loon 端拿到更适合当前网络的 Cloudflare IP
- 支持多个种子域名，支持逗号或换行输入
- 在目标域名变更、远端池失效或本地网络切换时保持稳态

## 默认种子梯队

这套项目默认按三梯队组织种子域名，优先级从上到下递减：

| 梯队 | 域名 | 说明 |
| --- | --- | --- |
| 第一梯队 | `time.cloudflare.com`、`speed.cloudflare.com`、`cdnjs.cloudflare.com` | Cloudflare 官方骨干资产，优先级最高 |
| 第二梯队 | `www.cloudflare.com`、`developers.cloudflare.com`、`workers.cloudflare.com`、`one.one.one.one` | Cloudflare 官方与基础设施相关入口，稳定性高 |
| 第三梯队 | `shopee.sg`、`shopee.tw`、`icook.tw`、`www.digitalocean.com`、`cloudflare.steamstatic.com` | 泛亚太和高带宽兜底域名，适合补充候选池 |

标准版默认启用完整三梯队，Lite 版默认使用精简子集，方便手机端省电运行。

## 目录结构

```text
CFSeededOptimizer/
├── .github/workflows/seed-pool-refresh.yml
├── Plugins/
├── Scripts/
├── tools/
├── data/
└── README.md
```

### 目录职责

| 目录 | 职责 |
| --- | --- |
| `.github/workflows/` | GitHub Actions 定时任务 |
| `tools/` | 服务器侧种子池收集工具 |
| `data/` | 中间结果与缓存文件 |
| `Scripts/` | Loon 脚本 |
| `Plugins/` | Loon 插件 |

## 架构分工

### GitHub 负责什么

- 定时解析稳定的 CF 种子域名
- 过滤 Cloudflare IPv4 网段
- 产出候选 IP 池到 [data/seed_pool.json](data/seed_pool.json)
- 给 Loon 提供远端中间结果
- 不处理你本地的最终映射和通知

### Loon 负责什么

- 优先读取远端 [data/seed_pool.json](data/seed_pool.json)
- 结合目标域名做最终测速和评分
- Gist 写入、旧映射清理、低打扰通知
- 在远端池不可用时回退到本地缓存或冷启动采集

### 手机端兜底原则

手机端不会默认承担全量种子收集。它只做：

- 消费 GitHub 侧产出的 seed pool
- 少量候选做最终确认
- 业务探针、HostMap 写入、通知和退避

## 推荐使用方式

### 标准版

订阅 [cf_seeded_optimizer.plugin](Plugins/cf_seeded_optimizer.plugin)。

适合：

- 你想要更好的最终效果
- 你愿意在手机上多做一点最终确认
- 你希望种子池、兜底、探针和清理逻辑都完整启用

### Lite 版

订阅 [cf_seeded_optimizer_lite.plugin](Plugins/cf_seeded_optimizer_lite.plugin)。

适合：

- 更在意省电和稳定
- 只想保留保守优选与兜底
- 手机端弱网或低电量场景

## GitHub Actions

工作流位于 [seed-pool-refresh.yml](.github/workflows/seed-pool-refresh.yml)。

它会定时执行 [tools/seed_pool_harvest.py](tools/seed_pool_harvest.py)，把种子池收集结果写入 [data/seed_pool.json](data/seed_pool.json)。

### 推荐配置

在仓库 `Variables` 中配置以下变量：

| 变量名 | 推荐值 | 说明 |
| --- | --- | --- |
| `CF_SEED_DOMAINS` | `time.cloudflare.com,speed.cloudflare.com,cdnjs.cloudflare.com,www.cloudflare.com,developers.cloudflare.com,workers.cloudflare.com,one.one.one.one,shopee.sg,shopee.tw,icook.tw,www.digitalocean.com,cloudflare.steamstatic.com` | 三梯队默认种子域名，支持逗号或换行 |
| `CF_MAX_SEED_DOMAINS` | `12` | 种子域名数量上限 |
| `CF_SEED_POOL_LIMIT` | `80` | 候选池上限 |

### 工作流默认行为

- 变量不填时使用脚本默认值
- 工作流只做种子池收集和落盘，不会触碰你的 Loon 本地配置
- 生成结果固定写入 [data/seed_pool.json](data/seed_pool.json)
- Loon 端优先使用本地缓存种子池，缓存失效或为空时再读取远端 JSON
- GitHub Actions 的收集任务默认 15 分钟超时，避免个别网络抖动拖住整轮任务

## Loon 侧使用流程

### 第一步：添加插件

在 Loon 中添加：

- [cf_seeded_optimizer.plugin](Plugins/cf_seeded_optimizer.plugin)
- 或 [cf_seeded_optimizer_lite.plugin](Plugins/cf_seeded_optimizer_lite.plugin)

### 第二步：配置参数

最少需要填：

- `CF_GIST_ID`
- `CF_TOKEN`
- `CF_TARGET_DOMAINS`

推荐同时填：

- `CF_SEED_POOL_URL`
- `CF_SEED_DOMAINS`
- `CF_GIST_FILE`

### 第三步：保存并运行

- 首次建议手动触发一次
- 看日志里的 `有效目标域名`、`种子域名`、`候选IP`、`DNS明细`
- 如果远端池不可用，脚本会回退到本地缓存或冷启动采集

### 第四步：观察结果

重点看这几项：

- 池最佳是否明显优于缓存 IP
- 是否触发了 Gist 更新
- 是否在删掉域名后清理了旧映射
- 是否能稳定保持较好的播放或访问体验

## 参数说明

### 标准版推荐参数

| 参数 | 推荐值 | 说明 |
| --- | --- | --- |
| `CF_CANDIDATE_LIMIT` | `30` | 最终参与优选的候选 IP 数量 |
| `CF_SEED_POOL_LIMIT` | `80` | 种子池上限 |
| `CF_FALLBACK_TARGET_LIMIT` | `6` | 目标域名兜底候选数量 |
| `CF_SEED_REFRESH_MINUTES` | `720` | 种子池缓存刷新间隔 |
| `CF_MIN_VALID_SEED_DOMAINS` | `2` | 最低有效种子数 |
| `CF_MIN_IMPROVEMENT` | `100` | 切换阈值 |
| `CF_STICKY_MS` | `220` | 粘滞阈值 |
| `CF_MIN_SWITCH_MINUTES` | `480` | 最小切换间隔 |
| `CF_EVAL_ROUNDS` | `4` | 评估轮数 |
| `CF_PING_SAMPLES` | `5` | 每个 IP 的测速采样次数 |
| `CF_JITTER_WEIGHT` | `0.9` | 抖动权重 |
| `CF_DNS_MARGIN_MS` | `80` | 显著优于 DNS 的阈值 |
| `CF_MAX_ACCEPT_DELAY` | `650` | 最大可接受延迟 |
| `CF_PROBE_TIMEOUT` | `6000` | 业务探针超时 |
| `CF_MIN_PROBE_KBPS` | `250` | 业务探针最低吞吐 |
| `CF_BAD_RUN_PAUSE_MINUTES` | `20` | 劣化退避 |

### Lite 版推荐参数

| 参数 | 推荐值 | 说明 |
| --- | --- | --- |
| `CF_CANDIDATE_LIMIT` | `12` | 少量候选，省电优先 |
| `CF_SEED_POOL_LIMIT` | `24` | 轻量种子池 |
| `CF_FALLBACK_TARGET_LIMIT` | `4` | 少量兜底候选 |
| `CF_SEED_REFRESH_MINUTES` | `1440` | 种子池更少刷新 |
| `CF_MIN_VALID_SEED_DOMAINS` | `1` | 更宽松兜底 |
| `CF_MIN_IMPROVEMENT` | `60` | 更容易切换 |
| `CF_STICKY_MS` | `260` | 更保守的粘滞 |
| `CF_MIN_SWITCH_MINUTES` | `720` | 更少切换 |
| `CF_EVAL_ROUNDS` | `2` | 更少轮数 |
| `CF_PING_SAMPLES` | `3` | 更少采样 |
| `CF_DNS_MARGIN_MS` | `60` | 更宽松的 DNS 门槛 |
| `CF_MAX_ACCEPT_DELAY` | `800` | 轻量模式容忍度更高 |
| `CF_PROBE_TIMEOUT` | `5000` | 业务探针超时 |
| `CF_MIN_PROBE_KBPS` | `200` | 探针最低吞吐 |
| `CF_BAD_RUN_PAUSE_MINUTES` | `30` | 更保守退避 |

### 目标域名参数

| 参数 | 推荐值 | 说明 |
| --- | --- | --- |
| `CF_TARGET_DOMAINS` | 你的反代域名，支持逗号或换行 | 最终优选对象 |
| `CF_USE_IN_PROXY` | `on` | 写入 `use-in-proxy=true` |
| `CF_OUTPUT_MODE` | `plugin` | 推荐插件模式，便于可视化排障 |
| `CF_GIST_FILE` | `CF_Seeded_HostMap.plugin` / `CF_Seeded_HostMap_Lite.plugin` | 映射文件名 |

### 远端种子池参数

| 参数 | 推荐值 | 说明 |
| --- | --- | --- |
| `CF_SEED_POOL_URL` | `https://raw.githubusercontent.com/cocktai1/CFSeededOptimizer/refs/heads/main/data/seed_pool.json` | GitHub Actions 产出的种子池 |
| `CF_SEED_DOMAINS` | 三梯队默认值或你的自定义稳定 CF 种子列表 | 本地冷启动兜底 |

## 两端职责边界

### GitHub 端应该做的事

- 种子域名解析
- Cloudflare 网段过滤
- 候选池 JSON 产出
- 定时更新和缓存

### Loon 端应该做的事

- 读取远端 seed pool
- 结合目标域名做最终优选
- 少量探针确认
- Gist 写入和清理旧映射
- 低打扰通知

### 不建议放到 GitHub 端的事

- 最终是否切换到哪个 IP
- 你当前手机网络下的真实播放体验判断
- Loon 本地 HostMap 清理与通知

## 推荐工作流

### 冷启动

1. 先跑 GitHub Actions，确保 [data/seed_pool.json](data/seed_pool.json) 有内容
2. 再在 Loon 里启用标准版插件
3. 观察一两轮后再决定是否切 Lite

### 默认优先级

1. 第一梯队用于先收 Cloudflare 官方骨干 IP
2. 第二梯队补充稳定的官方与基础设施入口
3. 第三梯队补充亚洲路由和大带宽兜底域名
4. Lite 版只保留最值得测的少量域名，降低手机耗电

### 日常运行

1. GitHub Actions 保持 12 小时刷新一次种子池
2. Loon 按小时做最终优选
3. 删除或增加目标域名后，脚本自动清理旧映射

### 手机端弱网

1. 切 Lite 版
2. 减少探针路径
3. 保持远端 seed pool 优先

## 故障排查

### 1. 远端种子池不可用

- 检查 [data/seed_pool.json](data/seed_pool.json) 是否已更新
- 检查 GitHub Actions 是否成功执行
- 看 Loon 日志里是否回退到本地缓存或冷启动采集

### 2. 目标域名没有切换

- 可能是当前候选并不明显优于 DNS
- 检查 `CF_MAX_ACCEPT_DELAY`
- 检查 `CF_DNS_MARGIN_MS`
- 检查 `CF_PROBE_PATH` 是否过于严格

### 3. 手机耗电偏高

- 降低 `CF_CANDIDATE_LIMIT`
- 降低 `CF_EVAL_ROUNDS`
- 降低 `CF_PING_SAMPLES`
- 关闭或减少 `CF_PROBE_PATH`

### 4. 删掉域名后旧映射还在

- 确保插件和脚本已更新到本仓库最新版本
- 再跑一次优选任务，让脚本同步清理 Gist

## 关键文件

- [README.md](README.md)
- [seed-pool-refresh.yml](.github/workflows/seed-pool-refresh.yml)
- [seed_pool_harvest.py](tools/seed_pool_harvest.py)
- [cf_seeded_optimizer.plugin](Plugins/cf_seeded_optimizer.plugin)
- [cf_seeded_optimizer_lite.plugin](Plugins/cf_seeded_optimizer_lite.plugin)
- [cf_seeded_optimize.js](Scripts/cf_seeded_optimize.js)

## 备注

当前目录不改动旧版项目，后续如需发布到 GitHub 仓库，可直接按此目录结构同步。
旧目录 [04_CF_Seeded_Optimizer](../04_CF_Seeded_Optimizer) 仅作为历史版本保留。
