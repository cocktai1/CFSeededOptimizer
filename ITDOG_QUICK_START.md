# ITDog 采集工具 - 快速参考指南

## 三种采集方案对比

```
┌─────────────────────────────────────────────────────────────────┐
│                     三种 CF IP 采集方案                          │
└─────────────────────────────────────────────────────────────────┘

方案 A: DNS 采集 (默认)
├─ 执行环境: GitHub Actions (云端)
├─ 频率: 每 12 小时自动
├─ 手机负载: ✓ 零
├─ 稳定性: ✓ 最高
├─ 配置: 无需配置 (开箱即用)
└─ 适合: 新用户、求稳定

方案 B: ITDog 本地采集 (推荐补充)
├─ 执行环境: Loon 手机端 (手动)
├─ 频率: 按需 (用户完全控制)
├─ 手机负载: ✓ 低 (本地 HTTP 调用)
├─ 稳定性: ✓ 良好 (自动降级到 DNS)
├─ 配置: 安装插件即可，点击运行
└─ 适合: 想要补充候选的文艺范儿用户

方案 C: 双策略自动合并 (完全自动)
├─ 执行环境: GitHub Actions
├─ 频率: 每 12 小时自动 (DNS+ITDog)
├─ 手机负载: ✓ 零
├─ 稳定性: ✓ 高 (多源容错)
├─ 配置: GA 环变: CF_HARVEST_STRATEGIES=dns,itdog
└─ 适合: 想要自动化的完全方案
```

## 快速判断：我应该用哪种方案？

```
⚠️  能否从 ITDog 确保获取所需的 IP？
│
├─ 是 (ITDog 通常能查到) 
│   └─→ 选方案 B (本地 ITDog 手动)
│        💡 Loon 按需触发，推送到 Gist/Repo
│
└─ 不确定或网络环境复杂
    └─→ 选方案 A + B (双轨制)
         💡 GA 保持 DNS 自动，Loon 按需 ITDog 补充
```

## 操作步骤

### 方案 A (无需操作 - 已默认)

```
✓ 现在就在自动运行
✓ 无需配置
✓ 每 12 小时自动产出 seed_pool.json
```

### 方案 B (推荐 - 本地 ITDog 手动)

```
步骤 1: 在 Loon 中安装插件
  → 打开 Loon
  → 配置 → 插件
  → + 添加插件
  → 输入 URL 或本地导入:
     https://raw.githubusercontent.com/cocktai1/CFSeededOptimizer/refs/heads/main/Plugins/cf_itdog_harvester.plugin

步骤 2: 运行采集
  → 回到 Loon 主页
  → 长按 "CF ITDog 采集工具" 插件图标
  → 选择 "▶ 运行脚本"
  → 等待 10-30 秒完成

步骤 3: 推送结果 (三选一)
  
  选项 3A: 推送到 Gist (推荐)
    ├─ 复制脚本输出的 JSON
    ├─ GitHub 创建 Gist (类型: JSON)
    ├─ 保存为 cf_seed_pool.json
    └─ 在 cf_seeded_optimizer.plugin 中配置 CF_GIST_ID

  选项 3B: 推送到本仓库
    ├─ 复制脚本输出的 JSON
    ├─ 本地编辑 data/seed_pool.json
    ├─ 运行: git add data/seed_pool.json && git commit -m "update seed" && git push
    └─ GitHub 和 Loon 下次会自动拉取

  选项 3C: 不推送 (本地缓存)
    └─ JSON 已存在 Loon 本地缓存中
      (作为兜底，网络切换时会用到)
```

### 方案 C (完全自动 - GA 双策略)

```
步骤 1: 在仓库 Settings 中配置变量
  → GitHub 仓库首页
  → Settings → Secrets and variables → Variables
  → New repository variable

  ┌─────────────────────────────────────┐
  │ Name: CF_HARVEST_STRATEGIES         │
  │ Value: dns,itdog                    │
  └─────────────────────────────────────┘

步骤 2: 保存，完成！
  → GA 接下来会自动执行双策略并合并结果
```

## ITDog 采集的原理

```
Loon 本地执行流程
  ↓
对每个种子域名查询 ITDog API
  ↓
解析 JSON 响应，提取 IP 列表
  ↓
过滤 CF CIDR 范围 (15 条范围逐一检查)
  ↓
去重聚合成 seed_pool.json 格式
  ↓
生成通知 + 输出 JSON 到控制台
  ↓
存储到 Loon 本地缓存
  ↓
(可选) 推送到 Gist / Git 仓库
```

## 常见问题

**Q: ITDog 网站掉了怎么办？**

A: 脚本自动降级原理
```
ITDog API 查询失败
  ↓
自动回退到直接 DNS 查询
  ↓
不会中断，继续下一个域名
```

**Q: 手动运行对手机有损害吗？**

A:
- ✓ 完全无损 (单纯 HTTP GET 请求)
- ✓ 低功耗 (纯本地计算，无后台驻留)
- ✓ 可控 (完全由你决定何时运行)

**Q: 能和 GA DNS 一起用吗？**

A: 完全支持多源合并
```
GA (每 12h)  →  DNS 采集  ↘
                          →  合并去重  →  seed_pool.json
Loon (按需)  →  ITDog 采集 ↗
```

**Q: 采集frequency 建议多久一次？**

A: 按需即可
- 周一/周末 (ISP 路由变化)
- 切换网络后 (Wi-Fi ↔ 4G/5G)
- 感觉延迟变差时

**Q: 和现有的标准优选插件冲突吗？**

A:
- ✗ 不冲突
- ✓ 互补
- 标准优选 = 负责最终测速 + Gist 写入
- ITDog 工具 = 只负责采集 seed pool

**Q: 失败策略/严格模式还要手动输入吗？**

A: 不需要（新版插件已支持点击选择）
- 失败策略：`keep_current` / `skip_domain` / `abort`
- 严格验活模式：`on` / `off`
- 输出模式：`plugin` / `host`

## 推荐工作流

```
┌───────────────────┐
│   日常运行模式     │
└───────────────────┘

自动层 (GA 每天两次)
  └─→ DNS 采集 → seed_pool.json (默认)

手动层 (用户按需)
  └─→ Loon 运行 ITDog 插件 → 推送到 Gist
                   ↓
                补充池更新
                   ↓
          标准优选插件拉取
                   ↓
            最终优选 + Gist 写入
```

## 参考文件位置

```
📁 新增文件
├─ tools/strategies/
│  ├─ base.py           # 策略基类
│  ├─ dns_harvester.py  # DNS 采集器
│  └─ itdog_harvester.py # ITDog 采集器
├─ Scripts/itdog_harvester.js  # ITDog 爬虫脚本
└─ Plugins/cf_itdog_harvester.plugin  # ITDog 采集插件

📝 更新的文件
├─ tools/seed_pool_harvest.py   # 支持多策略
├─ README.md                     # 完整文档
└─ .github/workflows/seed-pool-refresh.yml  # GA 配置
```

## 获取帮助

- 📖 完整文档: [README.md](../README.md)
- 🔗 仓库链接: https://github.com/cocktai1/CFSeededOptimizer
- 🐛 遇到问题: 检查 Loon 脚本日志
