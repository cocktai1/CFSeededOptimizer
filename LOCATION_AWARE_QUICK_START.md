# 位置感知 IP 采集 - 快速指南

> 根据你所在的城市和运营商，automatically 采集最匹配的 CF IP

## 🎯 特点

✅ **12 个城市支持** - 成都、北京、上海、广州、深圳、杭州、南京、武汉、西安、重庆、苏州、天津  
✅ **5 种运营商支持** - 电信、联通、移动、铁通、教育网  
✅ **4 种延迟偏好** - 极速(ultra_fast) / 快速(fast) / 均衡(balanced) / 稳定(stable)  
✅ **3 种网络类型** - 固定宽带 / 4G / 5G  
✅ **无文件下载**- 完全基于 ITDog 实时查询，IP 最新鲜  

---

## 🚀 快速开始 - 三种方式

### 方式 A：最简单 - GitHub Actions UI（⭐ 推荐）

1. **打开你的仓库** → Actions 页签
2. **左侧选择**："CF Seed Pool Refresh" 工作流
3. **右侧点击**："Run workflow" 按钮
4. **下拉菜单中填选**：
   ```
   • Target city: 选你的城市 (e.g., 成都)
   • Target ISP: 选你的运营商 (e.g., 电信)
   • Speed preference: 选速度偏好 (e.g., balanced)
   • Network type: 选网络类型 (e.g., fixed)
   • Enable location-aware: ✓ 打勾启用
   ```
5. **点击绿色** "Run workflow" 按钮
6. **等待 3-5 分钟**完成
7. ✅ **自动 commit 结果到 `data/seed_pool.json`**

**优点**：
- 图形化界面，无需看命令
- 参数清晰，下拉菜单防止错误
- 一键执行，自动保存

---

### 方式 B：自动化 - 仓库变量配置

在 Settings → Secrets and variables → Variables 中新增：

```
名称: CF_HARVEST_STRATEGIES
值:   dns,itdog_location

名称: CF_HARVEST_CITY
值:   成都  (改成你的城市)

名称: CF_HARVEST_ISP
值:   电信  (改成你的运营商)

名称: CF_HARVEST_SPEED_PREFERENCE
值:   balanced

名称: CF_HARVEST_NETWORK_TYPE
值:   fixed
```

**效果**：
- GA 每 12h 自动执行位置感知采集
- 无需每次手动操作
- 始终获得最新最优的 IP

---

### 方式 C：高级 - 本地命令行

```bash
# 最简单的
cd /path/to/CFSeededOptimizer
python tools/seed_pool_harvest.py --city 成都 --isp 电信

# 完整配置
python tools/seed_pool_harvest.py \
  --strategies dns,itdog_location \
  --city 成都 \
  --isp 电信 \
  --speed-preference balanced \
  --network-type fixed \
  --output data/seed_pool.json
```

**适用场景**：
- 本地测试新参数
- 脚本自动化集成
- 研发和调试

---

## 🗺️ 城市选择

| 城市 | 地区 | 覆盖范围 |
|------|------|---------|
| 成都 | 西南 | 四川、云南、西部 |
| 北京 | 华北 | 北京、华北地区 |
| 上海 | 华东 | 上海、长三角 |
| 广州 | 华南 | 广州、珠三角 |
| 深圳 | 华南 | 深圳、粤港澳 |
| 杭州 | 华东 | 杭州、浙江 |
| 南京 | 华东 | 南京、江苏 |
| 武汉 | 华中 | 武汉、中部 |
| 西安 | 西北 | 西安、陕甘宁 |
| 重庆 | 西南 | 重庆、西南 |
| 苏州 | 华东 | 苏州、江南 |
| 天津 | 华北 | 天津、环渤海 |

**如何选？** → 选择你实际所在的城市或最近的大城市

---

## 🏢 运营商选择

| 运营商 | ISP 代码 | 说明 |
|--------|--------|------|
| 电信   | 电信   | 中国电信 - 常见，南方优势 |
| 联通   | 联通   | 中国联通 - 均衡，北方优势 |
| 移动   | 移动   | 中国移动 - 用户最多 |
| 铁通   | 铁通   | 中国铁通 - 工业网络优先 |
| 教育网 | 教育网 | CERNET - 学术优先 |

**如何选？** → 选择你宽带的运营商

---

## ⚡ 延迟偏好

| 模式 | 代码 | 目标延迟 | 适用场景 |
|------|------|--------|---------|
| 极速 | ultra_fast | < 10ms | 竞技、直播 |
| 快速 | fast | < 30ms | 视频流 |
| 均衡 | balanced | < 80ms | 通用✓推荐 |
| 稳定 | stable | 任意 | 弱网、稳定优先 |

**如何选？** → 通常选 `balanced`，可稳定快速

---

## 📊 采集效果对比

```
采集策略          覆盖范围    精准度    耗时    自动度
─────────────────────────────────────────────────
DNS (默认)        全国        ⭐⭐⭐⭐  快    高
ITDog (本地)      补充        ⭐⭐⭐   中    无
位置感知 ✨       精准匹配    ⭐⭐⭐⭐⭐ 中    高
```

---

## 💡 使用建议

### 新用户
```
1. 第一次：使用方式 A（UI 交互）试试
2. 观察效果一周
3. 满意的话改用方式 B（自动化）
```

### 多地区部署
```
1. 分别为各地城市运行采集（方式 A 多次）
2. 或在 GA 中配置多个工作流实例
3. 产出不同 seed_pool JSON 文件
```

### 路由优化研究
```
python tools/seed_pool_harvest.py \
  --city 成都 --isp 电信 --output chengdu_ct.json

python tools/seed_pool_harvest.py \
  --city 北京 --isp 联通 --output beijing_cu.json

# 对比分析 IP 分布、延迟、可用性
```

---

## 🔧 故障排查

### Q: 采集结果很少或者为空？

A: 检查以下几点：
- ✓ 网络连接是否正常
- ✓ ITDog 网站是否可访问 (https://www.itdog.cn)
- ✓ 城市代码拼写是否正确
- ✓ GA 日志中是否有错误提示，检查 "Run workflow" → 最新运行 → 日志

### Q: 为什么有时候结果包含很多非 CF 的 IP？

A: 这是预期的。系统会：
1. 从 ITDog 获取域名指向的 IP 列表
2. **自动过滤** CF CIDR 范围（15 条）
3. 只保留 Cloudflare IP

如果结果中还有非 CF IP，说明过滤有漏洞，请报告 Issue。

### Q: 能否只采集特定 ISP 的 IP？

A: 可以。使用方式 C：
```bash
python tools/seed_pool_harvest.py \
  --city 成都 \
  --isp 电信 \
  --seed-domains time.cloudflare.com,speed.cloudflare.com
```

---

## 📝 原理解释

1. **位置参数** → 作为 ITDog API 查询条件
2. **ITDog API** → 返回该位置该运营商的 IP 列表
3. **CF CIDR 过滤** → 只保留 Cloudflare 官方网段
4. **去重聚合** → 合并多个种子域名的结果
5. **输出** → 标准 `seed_pool.json` 格式

---

## 🎓 高级用法

### 组合多策略采集

```bash
# DNS（基础稳定）+ 位置感知（增强匹配）
python tools/seed_pool_harvest.py \
  --strategies dns,itdog_location \
  --city 成都 \
  --isp 电信
```

### 批量采集对比

编写脚本：
```python
from tools.seed_pool_harvest import main
import sys

cities = ["成都", "北京", "上海"]
isps = ["电信", "联通"]

for city in cities:
    for isp in isps:
        print(f"\n采集 {city}/{isp}...")
        sys.argv = [
            "script",
            "--city", city,
            "--isp", isp,
            "--output", f"pools/{city}_{isp}.json"
        ]
        main()
```

---

还有问题？ 查看完整文档：[README.md](README.md) → "位置感知 ITDog 采集器"

