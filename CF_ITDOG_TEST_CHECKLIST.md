# CF 混合优选采集工具 - 测试清单 (v5)

## 目标
确保 v5 能力完整可用：
- 运行脚本版本正确（script=2026-04-09.v5）
- 通知不再出现 (null)
- 403/1034 风险 IP 会被拦截，不写入 HostMap
- 支持扩展域名池（CF_EXTRA_DOMAINS）并自动校验是否为 CF 域名
- 报告包含基线对比与底部总结

---

## Step 1: 导入或刷新插件

订阅地址：
https://raw.githubusercontent.com/cocktai1/CFSeededOptimizer/refs/heads/main/Plugins/cf_itdog_harvester.plugin

检查项：
- [ ] 插件名称显示为 CF 混合优选采集工具
- [ ] 参数页出现新增参数：CF_EXTRA_DOMAINS、CF_DNS_CONCURRENCY
- [ ] script-path 含 v5 参数（...cf_hybrid_harvester.js?v=20260409v5）

---

## Step 2: 参数建议（首轮）

必填：
- CF_TARGET_DOMAINS：你的目标域名（逗号或换行）

可选推荐：
- CF_EXTRA_DOMAINS：额外 CF 域名池（逗号或换行）
- CF_EVAL_CONCURRENCY：4
- CF_DNS_CONCURRENCY：4
- CF_PING_SAMPLES：4
- CF_EVAL_ROUNDS：3

说明：
- 扩展域名会自动做 CF 校验，非 CF 域名不会污染候选池。

---

## Step 3: 手动运行脚本

操作：
1. 长按插件
2. 选择 运行脚本

关键日志检查：
- [ ] 首行包含：script=2026-04-09.v5
- [ ] 出现：云端种子池、本地DNS状态、候选池就绪
- [ ] 出现底部总结块：本轮优选总结

---

## Step 4: 通知样式检查

预期：
- [ ] 通知显示为三段式文字（标题/副标题/正文）
- [ ] 不再出现 {(null)(null)} 这种对象式通知乱码

若仍异常：
- 清理 Loon 缓存并重启
- 删除插件后重新添加订阅

---

## Step 5: 可访问性安全门禁检查（重点）

目的：杜绝“测速可用但实际访问 403/1034”被写入。

预期：
- [ ] 命中 403 / Error 1034 / Edge IP Restricted 的候选会被拦截
- [ ] 当所有候选都不可访问时，脚本停止写入并发出拦截通知
- [ ] 报告 comparison.rejected_candidates 中有拦截原因（access_blocked_or_403_1034）

---

## Step 6: 对比决策检查

v5 会比较三条基线并自动择优：
- hybrid_pool
- dns_baseline
- current_hostmap

检查项：
- [ ] extended.final_best_source 存在且合理
- [ ] comparison 中有各基线对象与改善毫秒数
- [ ] 总结区显示“赢家来源”和改善量

---

## Step 7: 域名淘汰原因检查

检查项：
- [ ] invalid_target_domains 有值时，target_domain_diagnostics 提供原因
- [ ] 原因可见：not_cloudflare / no_a_record_or_dns_failed
- [ ] 总结区展示被淘汰域名和原因

---

## Step 8: 结果一致性检查

检查项：
- [ ] final_best.ip 与 gist_snippet_host 中 IP 一致
- [ ] output_mode=plugin 时，gist_snippet_plugin 内容正确
- [ ] Gist 写入成功日志存在

---

## Step 9: 性能与稳定性建议

若延迟波动大，可逐步调参：
1. CF_EVAL_CONCURRENCY 从 4 调到 3
2. CF_DNS_CONCURRENCY 从 4 调到 3
3. 保持 CF_PING_SAMPLES=4，必要时升到 5
4. 若耗时过长，把 CF_EVAL_ROUNDS 从 3 调到 2

---

## 常见问题速查

1) 还是出现旧版本日志
- 原因：脚本缓存未刷新
- 处理：删除插件订阅并重加，确认日志是 script=2026-04-09.v5

2) 结果里只有一个目标域名
- 原因：另一个域名未解析到 CF A 记录或不是 CF 域
- 看 target_domain_diagnostics 的 reason 字段

3) 通知仍不好看
- 先确认 v5 生效；若生效仍异常，属于 Loon 端通知展示限制，可只保留关键成功/失败通知

---

最后更新：2026-04-09
版本：v5
维护：CFSeededOptimizer
