# Loon 插件规范指南（LoonMaster Standard）

本文档记录了 CFSeededOptimizer 项目中所有插件的标准格式、设计原则和技术实现细节。

---

## 📋 目录

1. [插件格式概览](#插件格式概览)
2. [元标签规范](#元标签规范)
3. [脚本绑定规范](#脚本绑定规范)
4. [三个插件案例对比](#三个插件案例对比)
5. [常见问题排查](#常见问题排查)

---

## 插件格式概览

Loon 插件采用 `.plugin` 文件格式，由以下几部分组成：

```
元标签 (metadata)     [#!name, #!desc, #!icon, ...]
│
[Argument]            <可选> 用户输入参数
│
[Script]              脚本触发 + 绑定信息
│
[MITM]                <可选> HTTPS 拦截配置
│
[Rule]                <可选> 流量分流规则
```

---

## 元标签规范

### 必要元标签

| 标签 | 格式 | 说明 |
|------|------|------|
| `#!name` | `#!name=插件名称` | 插件在 Loon 主屏的显示名称 |
| `#!desc` | `#!desc=描述文本` | 长描述，显示在插件详情 |
| `#!author` | `#!author=作者名` | 插件作者（推荐加 @ 符号） |
| `#!system` | `#!system=ios` | 系统类型 |

### 推荐元标签

| 标签 | 格式 | 说明 | 示例 |
|------|------|------|------|
| `#!icon` | `#!icon=URL` | 插件图标（重要！） | `https://img.icons8.com/fluency/96/radar.png` |
| `#!loon_version` | `#!loon_version=3.2.1(733)` | 最低 Loon 版本 | - |
| `#!homepage` | `#!homepage=URL` | 项目主页链接 | - |
| `#!openUrl` | `#!openUrl=URL` | 点击图标打开的链接 | - |

### ⚠️ 图标处理关键技巧

**问题**：在 `[Script]` 中写 `img-url=...` 某些 Loon 版本会被忽略

**解决方案**：**必须**在头部元标签中定义：

```
#!icon=https://img.icons8.com/fluency/96/cloud-download.png
```

让 Loon 统一管理所有图标资源，避免分散定义导致的加载失败。

---

## 脚本绑定规范

### 触发机制分类

#### 1️⃣ 定时触发（cron）

**格式**：
```
cron "分 时 日 月 周" script-path=URL, tag=标签名, argument=[{VAR1},{VAR2}...]
```

**示例**：
```
cron "15 * * * *" script-path=https://raw.githubusercontent.com/cocktai1/CFSeededOptimizer/refs/heads/main/Scripts/cf_seeded_optimize.js, tag=CF种子优选, argument=[{CF_TOKEN},{CF_GIST_ID}]
```

**说明**：
- `"15 * * * *"` = 每小时的第15分钟运行
- `tag` = Loon 组件库中显示的脚本标签名
- `argument` = 使用现代数组语法，**不要**使用旧式字符串分割

#### 2️⃣ 网络变化触发（network-changed）

**格式**：
```
network-changed script-path=URL, tag=标签名, argument=[...]
```

**示例**：
```
network-changed script-path=https://..., tag=CF种子重测, argument=[{CF_TOKEN}]
```

**说明**：
- 当用户切换网络时自动触发（切Wi-Fi、3G→4G等）
- 不需要 cron时间表达式

#### 3️⃣ 手动触发（Mock Cron + Manual Identifier）

**问题**：Loon 中如何让脚本显示为"可手动运行"而不自动触发？

**标准解决方案**：使用**永不触发的 cron 表达式**

**格式**：
```
cron "0 0 31 2 *" script-path=URL, tag=标签名
```

**解释**：
- `"0 0 31 2 *"` = 二月的第31号午夜（实际不存在）
- 由于该时间永不发生，自动触发机制永不运行
- Loon UI 的"长按→运行脚本"操作仍然有效
- 用户可以手动按需执行

---

## 三个插件案例对比

### 案例 1：CF Seeded Optimizer（完整版）

**用途**：定时优选 + 网络切换重测 + 参数众多

**关键特性**：
- ✅ 两个 cron 触发（定时 + 网络变化）
- ✅ 参数数组 30+ 个
- ✅ 头部完整元标签

**文件**：`Plugins/cf_seeded_optimizer.plugin`

**核心部分**：
```
#!name=CF Seeded Optimizer
#!desc=三梯队种子域名喂候选池 + 目标域名最终优选...
#!author=@Lee
#!icon=https://img.icons8.com/fluency/96/radar.png
#!loon_version=3.2.1(733)

[Argument]
CF_TOKEN = input,"",tag=GitHub Token,desc=...
CF_GIST_ID = input,"",tag=Gist ID,desc=...
... (共30+个参数)

[Script]
cron "15 * * * *" script-path=https://..., tag=CF种子优选, argument=[{CF_TOKEN},{CF_GIST_ID},...]
network-changed script-path=https://..., tag=CF种子重测, argument=[...]

[MITM]
```

---

### 案例 2：CF Seeded Optimizer Lite（轻量版）

**用途**：定时优选 + 网络切换重测 + 参数精简

**关键特性**：
- ✅ 两个 cron 触发（与完整版相同机制）
- ✅ 参数数量减半（只保留关键参数）
- ✅ 间隔时间不同（`"20 * * * *"` vs 完整版的 `"15 * * * *"`）

**文件**：`Plugins/cf_seeded_optimizer_lite.plugin`

**体积对比**：
- 完整版：~50KB（参数众多）
- Lite 版：~32KB（参数精简）

---

### 案例 3：CF ITDog 采集工具（手动脚本）

**用途**：手动按需采集 ITDog IP，不自动触发

**关键特性**：
- ✅ 使用永不触发的 cron 表达式
- ✅ 脚本不含 [Argument] 部分（使用默认参数）
- ✅ 指向 GitHub 上的完整脚本 URL

**文件**：`Plugins/cf_itdog_harvester.plugin`

**完整代码**：
```
#!name=CF ITDog 采集工具
#!desc=从 ITDog 官网采集 CF IP...
#!author=@cocktai
#!icon=https://img.icons8.com/fluency/96/cloud-download.png
#!loon_version=3.2.1(733)
#!homepage=https://github.com/cocktai1/CFSeededOptimizer

[Argument]

[Script]
cron "0 0 31 2 *" script-path=https://raw.githubusercontent.com/cocktai1/CFSeededOptimizer/refs/heads/main/Scripts/itdog_harvester.js, tag=CF ITDog 采集

[MITM]
```

**运行方式**：
1. 长按 Loon 主屏的"CF ITDog 采集工具"插件
2. 选择"▶ 运行脚本"
3. 脚本手动执行（不会在二月31号自动运行）

---

## 常见问题排查

### ❌ 问题 1：图标显示为 "C" 或问号

**原因**：
1. 图标 URL 无法访问（被墙、链接失效）
2. 图标在 `[Script]` 中定义为 `img-url=`，而非头部 `#!icon=`
3. URL 格式错误

**排查步骤**：
```bash
# 1. 验证图标 URL 是否可访问
curl -I "https://img.icons8.com/fluency/96/cloud-download.png"
# 应返回 HTTP 200

# 2. 检查插件文件中是否使用了头部 #!icon=
grep "#!icon=" Plugins/cf_itdog_harvester.plugin

# 3. 确保没有在 [Script] 中定义过时的 img-url（会被忽略）
```

**解决方案**：
- 检查 icon URL 是否有效
- 确保图标定义在**头部元标签**中：`#!icon=URL`

---

### ❌ 问题 2：脚本不显示在 Loon UI 中

**原因**：
1. 缺少 `[Script]` 部分
2. `[Script]` 中没有 `tag=` 字段
3. cron 表达式格式错误

**正确格式检查**：
```
cron "0 0 31 2 *" script-path=URL, tag=脚本名称
```

必须包含三个部分：
- ✅ `cron` 关键字 + 表达式
- ✅ `script-path=` + URL
- ✅ `tag=` + 脚本显示名称

---

### ❌ 问题 3：手动脚本自动触发了

**原因**：cron 表达式包含有效时间

**错误示例**：
```
cron "0 0 * * *"  # ❌ 每天午夜都会触发！
cron "0 * * * *"  # ❌ 每小时都会触发！
```

**正确示例**：
```
cron "0 0 31 2 *"  # ✅ 二月31号不存在，永不触发
```

---

### ❌ 问题 4：参数无法传递

**原因**：使用过时的字符串分割方式

**错误方式**：
```javascript
let args = $argument.split("===");  // ❌ 旧式过时方式
let token = args[0];
```

**正确方式**：
```javascript
// 在插件中定义参数：
// argument=[{CF_TOKEN},{CF_GIST_ID}]

// 在脚本中直接访问：
let token = $argument.CF_TOKEN;  // ✅ 现代规范方式
let gistId = $argument.CF_GIST_ID;
```

---

## 防御性编程指导（LoonMaster 标准）

### 参数有效性检查

从 Loon UI 手动运行脚本时，`$argument` 可能无法解析 `{VAR}` 占位符。必须加入防御性检查：

```javascript
// 防御性护栏：检查参数有效性
if (!$argument || typeof $argument !== 'object' || Object.keys($argument).length === 0) {
    console.log("⚠️ 检测到参数缺失(Loon UI 手动运行)，已使用默认配置");
    // 使用预定义的默认值继续执行
}
```

### 持久化存储（try-catch 保护）

```javascript
// ❌ 危险做法：无异常处理
$persistentStore.write(...);

// ✅ 正确做法：防御性 try-catch
try {
    $persistentStore.write(JSON.stringify(data), "KEY");
    console.log("✅ 数据已保存");
} catch (e) {
    console.log(`⚠️ 保存失败: ${e.message}`);
}
```

---

## 图标资源推荐

### 免费高质量图标库

| 库 | 用途 | 链接 |
|---|------|------|
| icons8 | 通用、高质量、CDN 加速 | https://icons8.com |
| heroicons | 精简现代风格 | https://heroicons.com |
| feathericons | 极简线状 | https://feathericons.io |

### 推荐搭配

| 插件功能 | 推荐图标 | URL 示例 |
|---------|--------|---------|
| 优选/优化 | 雷达/闪电 | `radar.png` / `flash-on.png` |
| 采集/下载 | 云下载/搜索 | `cloud-download.png` / `search.png` |
| 监控/状态 | 波形/眼睛 | `waveform.png` / `eye.png` |
| 同步/更新 | 同步/刷新 | `synchronize.png` / `refresh.png` |

---

## 总结表格

| 插件类型 | 触发模式 | cron 表达式 | tag 必需 | [Argument] | 用例 |
|---------|--------|-----------|--------|----------|------|
| 自动定时 | `cron` | 有效时间 | ✅ | ✅ 可选 | 每小时优选 |
| 网络变化 | `network-changed` | N/A | ✅ | ✅ 可选 | 切网络时重测 |
| 手动按需 | `cron` 永不触发 | `0 0 31 2 *` | ✅ | ❌ 无 | 手动采集 |
| http 拦截 | `http-request` | N/A | ✅ | ❌ 无 | 登录拦截 |

---

## 快速参考

### 创建新插件的模板

```
#!name=我的插件
#!desc=简短描述
#!author=@作者名
#!icon=https://img.icons8.com/fluency/96/图标名.png
#!loon_version=3.2.1(733)

[Argument]
参数1 = input,"默认值",tag=参数标签,desc=描述
参数2 = input,"默认值",tag=参数标签,desc=描述

[Script]
cron "时间表达式" script-path=脚本URL, tag=显示名称, argument=[{参数1},{参数2}]

[MITM]
hostname = 需要拦截的域名 (如果有)
```

### 部署检查清单

- [ ] 元标签完整（name, desc, author, icon）
- [ ] 脚本格式正确（cron/network-changed/永不触发）
- [ ] tag 字段存在且不为空
- [ ] 脚本 URL 可访问
- [ ] 参数使用现代数组语法 `argument=[...]`
- [ ] 图标定义在头部 `#!icon=`
- [ ] [MITM] 部分正确（如果需要）
- [ ] 本地 Loon 测试通过

---

**版本**：1.0  
**更新**：2026-04-08  
**维护者**：LoonMaster  
**参考**：[Loon 官方文档](https://nsloon.app/docs/)
