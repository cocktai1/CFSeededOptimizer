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
| `CF_HARVEST_STRATEGIES` | `dns` | 采集策略，支持 `dns`、`itdog`、或 `dns,itdog` (多策略合并) |

### 工作流默认行为

- 变量不填时使用脚本默认值
- 工作流只做种子池收集和落盘，不会触碰你的 Loon 本地配置
- 生成结果固定写入 [data/seed_pool.json](data/seed_pool.json)
- Loon 端优先使用本地缓存种子池，缓存失效或为空时再读取远端 JSON
- GitHub Actions 的收集任务默认 15 分钟超时，避免个别网络抖动拖住整轮任务

## 采集策略系统

### 架构设计

从 v2.0 开始，CFSeededOptimizer 支持**可插拔的多策略采集系统**。不同的采集方案可以独立运行或互补协作：

```
Tier 1 采集系统（多策略引擎）
├─ 策略 A: DNS 采集器
│   └─ 执行环境：GitHub Actions（云端定时）
│   └─ 特点：✓ 稳定、✓ 低负载、✓ 自动化
├─ 策略 B: ITDog 爬虫
│   ├─ 执行环境 B1：Loon 本地（手动按需）
│   │  └─ 特点：✓ 补充、✓ 无 GA 负担、✓ 用户掌控
│   └─ 执行环境 B2：GitHub Actions（可选）
│      └─ 特点：✓ 定期更新、✓ 自动推送
└─ 策略 C：未来扩展（ITDog API、Shodan 等）

     ↓（所有策略产出统一格式）
     
seed_pool.json（合并后的候选池）
     ↓
Loon 手机端（Tier 2 优选引擎）
```

### 策略说明

#### 1️⃣ DNS 采集器（DNS Harvester）

**实现文件**：[tools/strategies/dns_harvester.py](tools/strategies/dns_harvester.py)

**特点**：
- 使用 socket API 进行 DNS 查询，稳定可靠
- 在 GitHub Actions 中定期执行（每 12 小时）
- 无手机负载
- 是项目的主要采集来源

**使用方式**：
```bash
# GitHub Actions 默认执行
python tools/seed_pool_harvest.py --strategies dns

# 或本地测试
python tools/seed_pool_harvest.py --strategies dns --seed-domains time.cloudflare.com,speed.cloudflare.com
```

#### 2️⃣ ITDog 爬虫（ITDog Harvester）

**实现文件**：
- Python 策略：[tools/strategies/itdog_harvester.py](tools/strategies/itdog_harvester.py)
- Loon 脚本：[Scripts/itdog_harvester.js](Scripts/itdog_harvester.js)

**特点**：
- 爬取 ITDog 官网的 CF IP 信息
- 补充 DNS 采集不足的候选池
- **本地手动运行**，无 GA 依赖，对手机低负载（Crowdsourced）
- 支持在 Loon 中一键触发，适合按需补充

**两种运行模式**：

**模式 A：Loon 本地手动采集** ⭐ 推荐（用户掌控）

1. 在 Loon 中安装 [cf_itdog_harvester.plugin](Plugins/cf_itdog_harvester.plugin)
2. Loon 主页长按插件图标 → **运行脚本**
3. 脚本在本地执行，查询 ITDog API，生成 `seed_pool.json` 格式
4. 输出 JSON 到控制台（供复制）
5. 选择推送方式：
   - **选项 A**：复制输出 JSON → GitHub Gist 创建/编辑 → `json_data.json`
   - **选项 B**：复制输出 JSON → 本地执行 `git` 命令提交 → `data/seed_pool.json`
   - **选项 C**：保留在本地缓存，不推送（用于后备种子池）

**模式 B：GitHub Actions 定期采集**（可选）

```bash
# 在 GitHub Actions Secrets 中配置
CF_HARVEST_STRATEGIES=dns,itdog  # 合并两个策略

# 或仅 ITDog
CF_HARVEST_STRATEGIES=itdog
```

执行后自动合并两个策略的结果，产出更丰富的候选池。

#### 3️⃣ 位置感知 ITDog 采集器（Location-Aware ITDog Harvester）

**实现文件**：[tools/strategies/location_aware_itdog_harvester.py](tools/strategies/location_aware_itdog_harvester.py)

**特点**：
- 支持 **12 个城市**选择（成都、北京、上海、广州、深圳、杭州、南京、武汉、西安、重庆、苏州、天津）
- 支持 **5 种运营商**选择（电信、联通、移动、铁通、教育网）
- 支持 **4 种延迟偏好**（极速、快速、均衡、稳定）
- 支持 **3 种网络类型**（固定宽带、4G、5G）
- IP 新鲜度偏好配置
- 自动降级容错（失败时）

**使用场景**：
- 针对特定网络环境优化（关键）
- 多地区部署时分别采集优化
- ISP 路由特性差异大时效果明显

**两种运行模式**：

**模式 A：GitHub Actions 手动运行** ⭐ **推荐**（高度定制化）

1. 打开仓库 Actions 页面
2. 选择 "CF Seed Pool Refresh" 工作流
3. 点击 **"Run workflow"** 按钮
4. 弹窗中填写参数：
   ```
   ✓ Target city: 选择你所在城市（默认成都）
   ✓ Target ISP: 选择你的运营商（默认电信）
   ✓ Speed preference: 选择延迟偏好（默认 balanced）
   ✓ Network type: 选择网络类型（默认固定宽带）
   ✓ Enable location-aware: ☑  启用位置感知采集
   ```
5. 点击 **"Run workflow"** 执行
6. 等待 3-5 分钟完成，自动 commit 结果

**模式 B：GitHub Actions 变量配置**（自动化）

在仓库 Settings → Secrets and variables → Variables 中配置：

| 变量名 | 推荐值 | 说明 |
| --- | --- | --- |
| `CF_HARVEST_STRATEGIES` | `dns,itdog_location` | 启用位置感知策略 |
| `CF_HARVEST_CITY` | `成都` | 默认城市 |
| `CF_HARVEST_ISP` | `电信` | 默认运营商 |
| `CF_HARVEST_SPEED_PREFERENCE` | `balanced` | 延迟偏好 |
| `CF_HARVEST_NETWORK_TYPE` | `fixed` | 网络类型 |
| `CF_HARVEST_PREFER_FRESH` | `true` | 偏好新鲜 IP |

设置后，GA 将在每 12h 自动执行位置感知采集。

**模式 C：命令行本地运行**（开发/测试）

```bash
# 成都电信，极速模式
python tools/seed_pool_harvest.py \
  --strategies itdog_location \
  --city 成都 \
  --isp 电信 \
  --speed-preference ultra_fast \
  --output data/seed_pool.json

# 北京联通，稳定模式，4G 网络
python tools/seed_pool_harvest.py \
  --strategies dns,itdog_location \
  --city 北京 \
  --isp 联通 \
  --speed-preference stable \
  --network-type 4g
```

### 城市支持列表

| 城市代码 | 中文名 | 区域 | 覆盖范围 |
| --- | --- | --- | --- |
| `成都` | Chengdu | 西南 | 成都、周边省份 |
| `北京` | Beijing | 华北 | 北京、华北地区 |
| `上海` | Shanghai | 华东 | 上海、长三角 |
| `广州` | Guangzhou | 华南 | 广州、珠三角 |
| `深圳` | Shenzhen | 华南 | 深圳、粤港澳 |
| `杭州` | Hangzhou | 华东 | 杭州、浙江 |
| `南京` | Nanjing | 华东 | 南京、江苏 |
| `武汉` | Wuhan | 华中 | 武汉、中部 |
| `西安` | Xian | 西北 | 西安、西北 |
| `重庆` | Chongqing | 西南 | 重庆、西南 |
| `苏州` | Suzhou | 华东 | 苏州、江南 |
| `天津` | Tianjin | 华北 | 天津、环渤海 |

### 运营商支持列表

| 运营商 | 中文名 | 说明 | 典型特性 |
| --- | --- | --- | --- |
| `电信` | Telecom | 中国电信 | 骨干网优先，南方主导 |
| `联通` | Unicom | 中国联通 | 全国均衡，北方优势 |
| `移动` | Mobile | 中国移动 | 用户最多，覆盖广 |
| `铁通` | Tietong | 中国铁通 | 工业网络优先 |
| `教育网` | CERNET | 中国教育网 | 学术优先，低延迟 |

### 延迟偏好说明

| 模式 | 阈值 | 适用场景 |
| --- | --- | --- |
| `ultra_fast` | < 10ms | 本地访问、竞技游戏、直播 |
| `fast` | < 30ms | 视频流媒体、内容分发 |
| `balanced` | < 80ms | 通用场景、大多数应用 |
| `stable` | 任何 | 稳定性优先、弱网环境 |

### 策略选择建议

| 场景 | 推荐方案 | 说明 |
| --- | --- | --- |
| 新用户、求稳定 | DNS 采集器（默认）| 已在 GA 中自动运行，无需配置 |
| 想要更多补充候选 | DNS + Loon ITDog 手动 | 定期 GA DNS，按需 Loon ITDog 补充 |
| 追求最优 IP 匹配 | GA 位置感知采集 | 根据城市/ISP 采集，效果最好 |
| 多地区/多 ISP 部署 | 多次位置感知采集 | 分别为不同地区采集最优 IP |
| 完全自动化方案 | GA 双策略或三策略 | 配置变量，自动化无人值守 |
| 追求最小手机负载 | GA 采集（任何）| 手机只做优选，采集全部 GA 承载 |

### 多策略合并规则

当运行多个策略时，系统会按以下规则合并结果：

1. **IPs 去重**：多个策略产生的重复 IP 自动合并
2. **域名验证**：统计所有策略的有效/无效域名
3. **元数据记录**：在 `extended` 字段记录各策略耗时和贡献度
4. **格式统一**：最终都输出标准 `seed_pool.json` 格式
5. **位置信息保存**：记录采集时的城市/ISP 参数

**合并输出示例**：
```json
{
  "seed_domains": [...],
  "valid_seed_domains": [...],
  "invalid_seed_domains": [...],
  "ips": [...],
  "updated_at": 1712500000,
  "source": "github-actions",
  "strategies": ["dns", "itdog_location"],
  "extended": {
    "strategies": ["dns", "itdog_location"],
    "strategy_count": 2,
    "location_context": {
      "city": "成都",
      "isp": "电信",
      "speed_preference": "balanced",
      "network_type": "fixed"
    },
    "strategy_details": [
      {"name": "dns", "ips": 45, "elapsed_ms": 325},
      {"name": "itdog_location_成都_电信", "ips": 38, "elapsed_ms": 1500}
    ]
  }
}
```

## 推荐配置方案

根据不同的使用场景和网络环境，本项目提供三套推荐配置。选择最符合你的需求的方案：

### 方案 A：GA 自动采集（推荐新用户）

**特点**：完全自动，无需手动操作，手机零负载

**GitHub Actions 配置**（无需手动修改，默认已启用）：
- **策略**：DNS 采集器
- **频率**：每 12 小时自动运行
- **依赖**：无（内置，无需安装）
- **效果**：稳定获得 19-25 个 CF IP，适合大多数场景

**配置步骤**：
1. Fork 本项目到你的 GitHub 账户
2. 给 Loon 添加 `cf_seeded_optimizer.plugin` 订阅
3. 该插件会自动定时从 `data/seed_pool.json` 拉取候选 IP
4. 无需任何其他配置，开箱即用

**效果说明**：
- ✓ 稳定性好：DNS 是最可靠的源
- ✓ 零依赖：不需要安装额外库
- ✓ 快速：通常 0.3-1 秒完成
- ⚠ 数量中等：通常 19-25 个 IP

---

### 方案 B：GA 手动高级采集（针对特定地区/ISP）

**特点**：手动触发，支持按城市、运营商、网络类型等参数所需，获得最贴切的 IP

**GitHub Actions 配置**：
1. 打开你的 GitHub 仓库
2. 进入 **Actions** 标签页
3. 选择 **CF Seed Pool Refresh** 工作流
4. 点击 **Run workflow** 按钮
5. 填入参数：
   - **Target city for location-aware harvesting**：你所在的城市（默认成都）
   - **Target ISP type**：你的运营商（默认电信）
   - **Speed preference level**：网络偏好（默认 balanced）
   - **Network type**：网络类型（默认 fixed）
   - ✅ **Enable location-aware ITDog harvesting**：勾选启用

**配置步骤**：
```bash
# 如果需要设置 GitHub 仓库变量（自动化下行），可选：
# 在 Settings → Secrets and variables → Variables 中添加：
CF_HARVEST_STRATEGIES=dns,itdog_location
CF_HARVEST_CITY=成都
CF_HARVEST_ISP=电信
CF_HARVEST_SPEED_PREFERENCE=balanced
CF_HARVEST_NETWORK_TYPE=fixed
```

**效果说明**：
- ✓ 精准匹配：获得最符合你当前 IP 的 CF 候选
- ✓ 数量丰富：通常 30-60 个 IP（取决于地区和 ISP）
- ✓ 多维度选择：支持 12 个城市 × 5 种 ISP 组合
- ⚠ 需要启用依赖：GA 会自动安装 `requests` 库
- ⚠ 采集耗时长：通常 1-3 分钟

**支持的城市**：成都、北京、上海、广州、深圳、杭州、南京、武汉、西安、重庆、苏州、天津

**支持的运营商**：电信、联通、移动、铁通、教育网

**速度偏好说明**：
| 偏好 | 延迟目标 | 适用场景 |
| --- | --- | --- |
| `ultra_fast` | < 10ms | 竞技游戏、直播、本地访问 |
| `fast` | < 30ms | 流媒体、内容分发 |
| `balanced` | < 80ms | 日常浏览、通用应用（推荐） |
| `stable` | 任意 | 弱网环境、稳定性优先 |

---

### 方案 C：Loon 本地 ITDog 采集（按需补充）

**特点**：在手机上按需运行，获取最新、最本地的 IP 候选，补充 GA 采集

**使用场景**：
- 刚切换到新城市/新 ISP
- 现有 IP 池效果不佳
- 需要紧急更新 IP

**配置步骤**：
1. 在 Loon 中添加插件订阅：
   ```
   https://raw.githubusercontent.com/cocktai1/CFSeededOptimizer/refs/heads/main/Plugins/cf_itdog_harvester.plugin
   ```
2. 返回 Loon 主页，长按 **CF ITDog 采集工具** 插件图标
3. 选择 **▶ 运行脚本** 开始采集
4. 等待 10-30 秒完成

**效果说明**：
- ✓ 即时更新：获取最新 ITDog 数据
- ✓ 本地运行：无需依赖 GA，实时可用
- ✓ 零手机负载：后台快速完成，不影响使用
- ✓ 自动合并：结果自动保存到本地缓存
- ⚠ 需要手动触发：不是自动的
- ⚠ 数量可变：取决于 ITDog 源数据（通常 15-40 个 IP）

---

### 配置效果对比

| 指标 | 方案 A（DNS） | 方案 B（位置感知） | 方案 C（Loon 本地） |
| --- | --- | --- | --- |
| **自动化程度** | 完全自动 | 手动触发 | 手动触发 |
| **采集周期** | 12 小时 | 按需 | 按需 |
| **IP 数量** | 19-25 | 30-60 | 15-40 |
| **地理精准度** | 中等 | 高（针对性） | 高（本地） |
| **采集耗时** | < 1 秒 | 1-3 分钟 | 10-30 秒 |
| **手机负载** | 无（GA 端） | 无（GA 端） | 极低（本地快速） |
| **依赖安装** | 无 | 首次需要 | 无 |
| **推荐用途** | 通用兜底 | 特定地区优化 | 应急更新补充 |

---

### 完整使用流程示例

**场景**：你在成都，用电信网络，想获得最优的 CF IP

**推荐流程**：
1. **初始化**（Day 1）：
   - ✓ 订阅 `cf_seeded_optimizer.plugin`（自动每 12h 从 GA DNS 采集拉取）

2. **精细优化**（Day 1 或需要时）：
   - ✓ 手动运行 GA 高级采集：
     - City: 成都
     - ISP: 电信
     - Speed: balanced
     - Enable location-aware: ✅
   - 📍 获得 30-60 个针对成都电信网络优化的 IP

3. **应急补充**（IP 失效或需要刷新时）：
   - ✓ 长按 Loon 的 **CF ITDog 采集工具** 插件
   - ✓ 运行脚本获得最新本地采集
   - 📍 获得额外 15-40 个本地 IP

4. **持续维护**（无需手动）：
   - ✓ GA 每 12 小时自动运行 DNS 采集
   - ✓ Loon 定时优选并写入 Gist
   - ✓ 完全自动化，无需人工干预

---

### 常见问题

**Q：我刚开始使用，应该选哪个方案？**

A：选择 **方案 A（DNS 自动采集）**。它开箱即用，无需配置，稳定可靠。后续如果想进一步优化，再尝试其他方案。

---

**Q：方案 B（位置感知）和方案 C（Loon 本地）有什么区别？**

A：
- **方案 B**：在 GitHub 云端运行，采集全国各城市/ISP 的 ITDog 数据，适合远程部署或多地区
- **方案 C**：在手机本地运行，采集你当前网络的实时 ITDog 数据，适合即时更新和应急补充

---

**Q：可以同时使用多个方案吗？**

A：完全可以！实际上这是 **推荐做法**：
- 方案 A 作为基础兜底（DNS，自动）
- 方案 B 作为精细优化（位置感知，按需）
- 方案 C 作为应急补充（本地 ITDog，按需）

三套方案的结果会自动去重合并，产生最丰富的 IP 候选池。

---

**Q：GA 运行方案 B 时报错 `requests library not found`？**

A：这是正常的。GA 会在你勾选"Enable location-aware"时自动安装 `requests` 库。如果仍然报错，请检查：
1. 确认在 GitHub Actions 界面勾选了"Enable location-aware ITDog harvesting"
2. 等待 GA 完成依赖安装（通常 10-20 秒）

## 本地 ITDog 采集工具使用指南

### 快速开始

1. **安装插件**

   在 Loon 中添加订阅或本地导入：
   ```
   https://raw.githubusercontent.com/cocktai1/CFSeededOptimizer/refs/heads/main/Plugins/cf_itdog_harvester.plugin
   ```
   或复制 [cf_itdog_harvester.plugin](Plugins/cf_itdog_harvester.plugin) 内容到本地

2. **运行采集**

   - Loon 主页长按插件图标
   - 选择 **▶ 运行脚本**
   - 等待完成（通常 10-30 秒）
   - 通知栏会提示结果摘要

3. **推送结果**

   采集完成后，你会看到 `seed_pool.json` 的完整 JSON 输出。选择下列方式之一推送：

   **方式 1：推送到 GitHub Gist**（推荐）
   ```
   1. 复制 JSON 输出
   2. 创建或编辑 GitHub Gist，保存为 json_data.json
   3. 在 cf_seeded_optimizer.plugin 中配置 CF_GIST_ID 和 CF_TOKEN
   4. Loon 下次运行时会自动拉取这个 Gist
   ```

   **方式 2：推送到 GitHub 仓库**（Git）
   ```
   1. 复制 JSON 输出，保存到本地 data/seed_pool.json
   2. 执行：git add data/seed_pool.json && git commit -m "update: ITDog harvest" && git push
   3. GitHub Actions 和 Loon 都会自动拉取更新
   ```

   **方式 3：保留本地缓存**（不推送）
   ```
   JSON 已保存到 Loon 本地缓存键 CF_ITDOG_HARVEST_RESULT
   下次网络切换时会自动用到作为兜底
   ```

### 采集日志示例

```
🚀 Starting ITDog harvest for 12 seed domains...

[1/12] Querying: time.cloudflare.com
  ✓ ITDog API for time.cloudflare.com: 3 IPs
  → Found 3 CF IPs

[2/12] Querying: speed.cloudflare.com
  ✓ ITDog API for speed.cloudflare.com: 5 IPs
  → Found 5 CF IPs

...

✅ Harvest complete:
  📊 Seed domains: 12
  ✓ Valid: 11
  ✗ Invalid: 1
  🔗 Unique IPs: 45
  📅 Updated: 2024-04-08T10:30:00Z
```

### 常见问题

**Q: 采集需要自己手动运行吗？**

A: 是的。B 策略（ITDog）完全由用户手动控制，这样对手机负载最小。如果想自动化，可在 GA 中配置 `CF_HARVEST_STRATEGIES=dns,itdog`。

**Q: 如果 ITDog 网站掉了怎么办？**

A: 脚本会自动降级到 DNS 直查（`_resolve_domain_direct`），不会中断。多策略的好处就是容错更好。

**Q: 多久采集一次比较合适？**

A: 建议按需。可以在以下场景手动触发：
- 周一/周末（ISP 路由变化）
- 切换网络后（Wi-Fi/4G/5G）
- 感觉延迟变化时

**Q: 能和 GA DNS 策略一起合并吗？**

A: 完全支持。如果既启用 GA 的 DNS，又手动运行了 ITDog，推送到同一个 Gist 或文件时会自动合并去重。

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
- [.github/workflows/seed-pool-refresh.yml](.github/workflows/seed-pool-refresh.yml)
- **核心采集框架**
  - [tools/seed_pool_harvest.py](tools/seed_pool_harvest.py) - 多策略采集调度器
  - [tools/strategies/base.py](tools/strategies/base.py) - 策略基类
- **采集策略实现**
  - [tools/strategies/dns_harvester.py](tools/strategies/dns_harvester.py) - DNS 采集器
  - [tools/strategies/itdog_harvester.py](tools/strategies/itdog_harvester.py) - ITDog 采集器
- **Loon 脚本和插件**
  - [Scripts/cf_seeded_optimize.js](Scripts/cf_seeded_optimize.js) - 标准优选脚本
  - [Scripts/itdog_harvester.js](Scripts/itdog_harvester.js) - ITDog 本地爬虫脚本
  - [Plugins/cf_seeded_optimizer.plugin](Plugins/cf_seeded_optimizer.plugin) - 标准优选插件
  - [Plugins/cf_seeded_optimizer_lite.plugin](Plugins/cf_seeded_optimizer_lite.plugin) - Lite 插件
  - [Plugins/cf_itdog_harvester.plugin](Plugins/cf_itdog_harvester.plugin) - ITDog 采集插件
- [cf_seeded_optimize.js](Scripts/cf_seeded_optimize.js)

## 备注

当前目录不改动旧版项目，后续如需发布到 GitHub 仓库，可直接按此目录结构同步。
旧目录 [04_CF_Seeded_Optimizer](../04_CF_Seeded_Optimizer) 仅作为历史版本保留。
