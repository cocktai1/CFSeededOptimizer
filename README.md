# CFSeededOptimizer

正式项目名：CFSeededOptimizer。

独立的 Cloudflare 种子优选项目。

## 目录

- `Plugins/`：Loon 插件文件
- `Scripts/`：Loon 脚本文件

## 设计目标

- 支持多个 CF 种子域名，用逗号或换行输入
- 自动过滤非 CF 域名
- 用种子池减少盲扫测速负载
- 保留目标域名自身解析作为兜底
- 适合手机端 Loon 常驻运行

## 推荐使用方式

1. 先订阅 `cf_seeded_optimizer.plugin`
2. 如果你更在意省电与稳定，改用 `cf_seeded_optimizer_lite.plugin`
3. 再按需调整种子域名、目标域名、候选上限和探针参数

## GitHub Actions

工作流文件位于 `.github/workflows/seed-pool-refresh.yml`。

建议在仓库 `Variables` 中配置：

- `CF_SEED_DOMAINS`
- `CF_MAX_SEED_DOMAINS`
- `CF_SEED_POOL_LIMIT`

工作流默认只做种子池收集与落盘，不会触碰你的 Loon 本地配置。

## 备注

当前目录不改动旧版项目，后续如需发布到 GitHub 仓库，可直接按此目录结构同步。
旧目录 [04_CF_Seeded_Optimizer](../04_CF_Seeded_Optimizer) 仅作为历史版本保留。
