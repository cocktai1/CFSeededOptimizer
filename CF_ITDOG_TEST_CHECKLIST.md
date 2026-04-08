# CF ITDog 采集工具 - 测试清单

## 🎯 问题修复说明

### 原问题
- ❌ 插件图标显示为"C"而不是云下载图标
- ❌ 插件无法在 Loon UI 中正确识别为可执行脚本
- ❌ 脚本绑定方式不符合 Loon 官方规范

### 修复方案
按照 **LoonMaster 标准** 重写插件：
1. ✅ 图标定义移至头部元标签：`#!icon=https://...`
2. ✅ 脚本绑定使用标准格式：`cron "0 0 31 2 *" script-path=URL, tag=名称`
3. ✅ 永不触发的 cron 表达式确保手动运行模式
4. ✅ 脚本指向 GitHub 远程 URL

**修复后的插件文件**：[cf_itdog_harvester.plugin](Plugins/cf_itdog_harvester.plugin)

**规范指南**：[PLUGIN_SPEC.md](PLUGIN_SPEC.md)（包含三个插件对比）

---

## ✅ 测试清单

### Step 1: 刷新 Loon 订阅或重新导入插件

**方式 A：使用 URL 订阅**
```
1. 打开 Loon
2. 主页 → 左上角"≡" → 订阅
3. 选择相应方式添加订阅：
   https://raw.githubusercontent.com/cocktai1/CFSeededOptimizer/refs/heads/main/Plugins/cf_itdog_harvester.plugin
4. 等待加载完成
```

**方式 B：本地复制导入**
```
1. 复制 cf_itdog_harvester.plugin 内容
2. Loon 主页 → 主菜单 → 本地编辑
3. 新建文件，粘贴内容
4. 保存为 .plugin 格式
```

---

### Step 2: 验证图标是否正确显示

**检查项**：
- [ ] 插件列表中看到"CF ITDog 采集工具"
- [ ] 图标显示为**蓝色云下载符号** ☁️，**不是** "C" 或问号
- [ ] 长按插件图标，菜单显示内容正常

---

### Step 3: 验证脚本可手动运行

**操作**：
```
1. Loon 主屏，找到"CF ITDog 采集工具"插件
2. 长按插件图标
3. 选择"▶ 运行脚本"
```

**预期结果**：
- ✅ 脚本开始执行（Loon 会显示运行中的通知）
- ✅ 控制台显示采集进度：
  ```
  🚀 Starting ITDog harvest for 12 seed domains...
  🔄 CF ITDog Harvester initialized
  📍 Running as: Manual Trigger (Loon UI 长按运行)
  
  [1/12] Querying: time.cloudflare.com
  ✓ ITDog API for time.cloudflare.com: X IPs
  ...
  ```
- ✅ 采集完成后收到通知：
  ```
  ✅ CF ITDog 采集完成
  成功: X | IP 池: Y | 时间: ...
  ```

---

### Step 4: 验证脚本不会自动触发

**检查项**：
- [ ] 重启 Loon 后，脚本**不会**自动运行
- [ ] 关闭 Loon 过夜，第二天打开时**不会**看到脚本运行记录
- [ ] 在"任务"或"日志"中搜索 "CF ITDog"，**看不到**自动触发的记录

**原理解释**：
- cron 表达式 `"0 0 31 2 *"` 表示"二月的第31号午夜"
- 二月永远没有第31天，所以该时间永不发生
- 因此脚本永不自动运行，只能手动执行

---

### Step 5: 验证采集结果有效性

**操作**：
```
1. 运行脚本后观察控制台输出
2. 查看 seed_pool.json 数据
```

**预期结果**：
- ✅ 至少采集到 5-15 个 CF IP
- ✅ 所有 IP 都在以下 CIDR 范围内：
  ```
  103.21.244.0/22, 103.22.200.0/22, ...（共15个范围）
  ```
- ✅ JSON 输出格式正确：
  ```json
  {
    "seed_domains": [...],
    "valid_seed_domains": [...],
    "invalid_seed_domains": [...],
    "ips": [...],
    "updated_at": 1712345678,
    "source": "loon-itdog-harvester-v2"
  }
  ```

---

### Step 6: 验证数据持久化

**操作**：
```
1. 第一次运行脚本，采集并完成
2. 立即重新运行脚本
```

**预期结果**：
- ✅ 控制台显示：`✅ Result saved to local cache: CF_ITDOG_HARVEST_RESULT`
- ✅ 采集结果保存到 Loon 本地缓存
- ✅ 即使网络离线，本地缓存仍可用于兜底

---

## 🐛 常见问题排查

### 问题 1：图标仍然显示为 "C"

**原因**：Loon 缓存未刷新

**解决**：
```
1. Loon 设置 → 高级 → 清除缓存
2. 完全退出 Loon（从后台杀死进程）
3. 重启 Loon
4. 重新刷新插件订阅或导入
```

---

### 问题 2：脚本不出现在菜单中

**原因**：插件格式错误

**检查`**：
```bash
# 验证插件文件格式
cat Plugins/cf_itdog_harvester.plugin | head -20

# 应该看到：
# #!name=CF ITDog 采集工具
# #!desc=...
# #!icon=...
# [Script]
# cron "0 0 31 2 *" script-path=...
```

---

### 问题 3：脚本运行但采集失败

**原因**：ITDog API 不可达

**排查**：
```
1. 检查网络连接
2. 验证 ITDog 官网是否可访问：https://www.itdog.cn
3. 查看控制台错误信息
4. 如果 ITDog 被墙，需要代理或更换源
```

---

### 问题 4：脚本自动运行了

**原因**：使用了错误的 cron 表达式

**验证**：
```bash
grep 'cron' Plugins/cf_itdog_harvester.plugin

# 正确：
# cron "0 0 31 2 *" script-path=...

# 错误示例（会自动运行）：
# cron "0 0 * * *"       # 每天午夜运行
# cron "0 * * * *"       # 每小时运行
# cron "15 * * * *"      # 每小时第15分钟运行
```

---

## 📊 性能基准

| 指标 | 预期值 | 说明 |
|------|--------|------|
| 采集耗时 | 15-30 秒 | 取决于网络和 ITDog 响应速度 |
| 采集 IP 数 | 15-40 个 | 通常 20-30 个 CF IP |
| 初次运行 | 首次需完整采集 | 后续有本地缓存 |
| 手机负载 | 极低 | 不阻塞主线程，后台快速完成 |

---

## 🎓 学习路径

1. **理解插件格式**：阅读 [PLUGIN_SPEC.md](PLUGIN_SPEC.md)
2. **对比三个插件**：查看 Plugins/ 目录中的三个 .plugin 文件
3. **查看脚本实现**：[Scripts/itdog_harvester.js](Scripts/itdog_harvester.js)
4. **查看官方文档**：https://nsloon.app/docs/intro

---

## 🚀 下一步

- [ ] 测试通过后，将 seed_pool.json 推送到 GitHub 或 Gist
- [ ] 配置 GA 定时采集，作为 Tier 1 兜底
- [ ] 可选：添加多个城市/ISP 的 ITDog 采集任务

---

**最后更新**：2026-04-08  
**版本**：1.0  
**维护**：LoonMaster
