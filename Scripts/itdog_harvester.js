// Hybrid CF Harvester for Loon (Cloud + Local + Final Local Competition)
// 目标：融合云端 seed_pool 与本地实时采集，在本地做大比拼，给出反代域名最佳 IP。

const ARG = (typeof $argument === "object" && $argument !== null) ? $argument : {};
const isPlaceholder = (value) => typeof value === "string" && /^\{.+\}$/.test(value.trim());

const DEFAULT_SEED_DOMAIN_GROUPS = {
    tier1: ["time.cloudflare.com", "speed.cloudflare.com", "cdnjs.cloudflare.com"],
    tier2: ["www.cloudflare.com", "developers.cloudflare.com", "workers.cloudflare.com", "one.one.one.one"],
    tier3: ["shopee.sg", "shopee.tw", "icook.tw", "www.digitalocean.com", "cloudflare.steamstatic.com"],
};
const DEFAULT_SEED_DOMAINS = [
    ...DEFAULT_SEED_DOMAIN_GROUPS.tier1,
    ...DEFAULT_SEED_DOMAIN_GROUPS.tier2,
    ...DEFAULT_SEED_DOMAIN_GROUPS.tier3,
];

const TARGET_DOMAINS_RAW = String(ARG.CF_TARGET_DOMAINS || "").trim();
const SEED_DOMAINS_RAW = String(ARG.CF_SEED_DOMAINS || DEFAULT_SEED_DOMAINS.join("\n")).trim();
const SEED_POOL_URL = String(ARG.CF_SEED_POOL_URL || "https://raw.githubusercontent.com/cocktai1/CFSeededOptimizer/refs/heads/main/data/seed_pool.json").trim();
const GITHUB_TOKEN = String(ARG.CF_TOKEN || "").trim();
const GIST_ID = String(ARG.CF_GIST_ID || "").trim();
const GIST_FILENAME = String(ARG.CF_GIST_FILE || "CF_HostMap.plugin").trim();
const OUTPUT_MODE = String(ARG.CF_OUTPUT_MODE || "plugin").trim().toLowerCase();
const REQUEST_TIMEOUT = 6000;
const MAX_SEED_DOMAINS = Math.min(24, Math.max(6, Number.parseInt(String(ARG.CF_MAX_SEED_DOMAINS || "12"), 10) || 12));
const CANDIDATE_LIMIT = Math.min(120, Math.max(10, Number.parseInt(String(ARG.CF_CANDIDATE_LIMIT || "40"), 10) || 40));
const MAX_IPS = Math.min(160, Math.max(20, Number.parseInt(String(ARG.CF_SEED_POOL_LIMIT || "80"), 10) || 80));
const EVAL_ROUNDS = Math.min(5, Math.max(1, Number.parseInt(String(ARG.CF_EVAL_ROUNDS || "3"), 10) || 3));
const PING_SAMPLES = Math.min(6, Math.max(2, Number.parseInt(String(ARG.CF_PING_SAMPLES || "4"), 10) || 4));
const JITTER_WEIGHT = Number.parseFloat(String(ARG.CF_JITTER_WEIGHT || "0.9")) || 0.9;
const PROBE_PATH = String(ARG.CF_PROBE_PATH || "/system/info/public,/web/index.html").trim();
const PROBE_TIMEOUT = Number.parseInt(String(ARG.CF_PROBE_TIMEOUT || "6000"), 10) || 6000;
const MIN_PROBE_KBPS = Number.parseInt(String(ARG.CF_MIN_PROBE_KBPS || "250"), 10) || 250;

const STORE_RESULT_KEY = "CF_HYBRID_HARVEST_RESULT";
const STORE_BEST_KEY = "CF_LOCAL_BEST_IP_RESULT";

const CF_IPV4_CIDRS = [
    "103.21.244.0/22",
    "103.22.200.0/22",
    "103.31.4.0/22",
    "104.16.0.0/13",
    "104.24.0.0/14",
    "108.162.192.0/18",
    "131.0.72.0/22",
    "141.101.64.0/18",
    "162.158.0.0/15",
    "172.64.0.0/13",
    "173.245.48.0/20",
    "188.114.96.0/20",
    "190.93.240.0/20",
    "197.234.240.0/22",
    "198.41.128.0/17",
];

function parseDomainList(rawValue) {
    const decoded = String(rawValue || "")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "\r");

    return Array.from(new Set(
        decoded
            .split(/[\r\n,]+/)
            .map(item => normalizeDomainToken(item))
            .filter(Boolean)
    ));
}

function normalizeDomainToken(rawDomain) {
    const value = String(rawDomain || "").trim();
    if (!value) return "";
    let normalized = value;
    normalized = normalized.replace(/^https?:\/\//i, "");
    normalized = normalized.split("/")[0];
    normalized = normalized.split(":")[0];
    return normalized.trim().toLowerCase();
}

function hasValidGistAuth() {
    if (!GITHUB_TOKEN || !GIST_ID) return false;
    if (isPlaceholder(GITHUB_TOKEN) || isPlaceholder(GIST_ID)) return false;
    return true;
}

function uniqueIPv4List(items) {
    const seen = new Set();
    const result = [];
    for (const ipAddress of items || []) {
        const ip = String(ipAddress || "").trim();
        if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) continue;
        const parts = ip.split(".").map(n => Number.parseInt(n, 10));
        if (parts.some(n => Number.isNaN(n) || n < 0 || n > 255)) continue;
        if (seen.has(ip)) continue;
        seen.add(ip);
        result.push(ip);
    }
    return result;
}

function ipv4ToInt(ipAddress) {
    const parts = ipAddress.split(".").map(value => Number.parseInt(value, 10));
    if (parts.length !== 4 || parts.some(value => Number.isNaN(value) || value < 0 || value > 255)) return null;
    return (((parts[0] << 24) >>> 0) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function buildCidrEntries(cidrs) {
    return cidrs.map(cidr => {
        const [baseIp, prefixLengthRaw] = cidr.split("/");
        const prefixLength = Number.parseInt(prefixLengthRaw, 10);
        const base = ipv4ToInt(baseIp);
        if (base === null || Number.isNaN(prefixLength) || prefixLength < 0 || prefixLength > 32) return null;
        const mask = prefixLength === 0 ? 0 : ((0xffffffff << (32 - prefixLength)) >>> 0);
        return { base: (base & mask) >>> 0, mask };
    }).filter(Boolean);
}

const CF_CIDR_ENTRIES = buildCidrEntries(CF_IPV4_CIDRS);

function isCloudflareIPv4(ipAddress) {
    const value = ipv4ToInt(ipAddress);
    if (value === null) return false;
    return CF_CIDR_ENTRIES.some(entry => ((value & entry.mask) >>> 0) === entry.base);
}

function parseIPsFromAnyJSON(jsonData) {
    const ips = [];
    if (!jsonData) return ips;
    const data = typeof jsonData === "string" ? JSON.parse(jsonData) : jsonData;
    if (Array.isArray(data)) {
        for (const item of data) {
            if (typeof item === "string") ips.push(item);
            else if (item && typeof item === "object") {
                if (item.ip) ips.push(item.ip);
                if (item.address) ips.push(item.address);
            }
        }
        return uniqueIPv4List(ips);
    }

    if (data && typeof data === "object") {
        const dataList = Array.isArray(data.data) ? data.data : [];
        for (const item of dataList) {
            if (typeof item === "string") ips.push(item);
            else if (item && typeof item === "object") {
                if (item.ip) ips.push(item.ip);
                if (item.address) ips.push(item.address);
            }
        }
        if (Array.isArray(data.ips)) ips.push(...data.ips);
        if (data.ip) ips.push(data.ip);
        if (Array.isArray(data.Answer)) {
            for (const answer of data.Answer) {
                if (answer && answer.data) ips.push(answer.data);
            }
        }
    }
    return uniqueIPv4List(ips);
}

function parseSeedPoolPayload(rawValue) {
    if (!rawValue) return null;
    try {
        const payload = JSON.parse(rawValue);
        return {
            ips: uniqueIPv4List(Array.isArray(payload.ips) ? payload.ips : []),
            updatedAt: Number.parseInt(String(payload.updated_at || payload.updatedAt || "0"), 10) || 0,
            source: String(payload.source || "remote-seed-pool")
        };
    } catch (error) {
        return null;
    }
}

function normalizeProbePath(value) {
    if (!value) return "";
    if (value.startsWith("http://") || value.startsWith("https://")) {
        const slashIndex = value.indexOf("/", value.indexOf("//") + 2);
        return slashIndex >= 0 ? value.slice(slashIndex) : "/";
    }
    return value.startsWith("/") ? value : `/${value}`;
}

function normalizeProbePathList(value) {
    if (!value) return [];
    return String(value)
    .split(/[\n,]+/)
        .map(part => normalizeProbePath(part.trim()))
        .filter(Boolean)
        .slice(0, 4);
}

async function fetchRemoteSeedPool(url) {
    if (!url) return null;
    return new Promise(resolve => {
        $httpClient.get({ url, timeout: 5000, node: "DIRECT" }, (err, resp, data) => {
            if (err || !resp || resp.status !== 200 || !data) {
                resolve(null);
                return;
            }
            resolve(parseSeedPoolPayload(data));
        });
    });
}

async function fetchDoHARecords(domainName) {
    const endpoints = [
        {
            name: "alidns",
            url: `https://dns.alidns.com/resolve?name=${encodeURIComponent(domainName)}&type=A`,
            headers: { "Accept": "application/dns-json", "User-Agent": "Loon" }
        },
        {
            name: "cloudflare-dns",
            url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domainName)}&type=A`,
            headers: { "Accept": "application/dns-json", "User-Agent": "Loon" }
        },
        {
            name: "dns-google",
            url: `https://dns.google/resolve?name=${encodeURIComponent(domainName)}&type=A`,
            headers: { "Accept": "application/dns-json", "User-Agent": "Loon" }
        }
    ];

    const results = await Promise.all(endpoints.map(endpoint => new Promise(resolve => {
        $httpClient.get({ url: endpoint.url, headers: endpoint.headers, timeout: 3000, node: "DIRECT" }, (err, resp, data) => {
            if (err || !resp || resp.status !== 200 || !data) {
                resolve([]);
                return;
            }
            try {
                resolve(parseIPsFromAnyJSON(data));
            } catch (error) {
                resolve([]);
            }
        });
    })));
    return uniqueIPv4List(results.flat());
}

async function collectLocalSeedIPs(seedDomains) {
    const validSeedDomains = [];
    const invalidSeedDomains = [];
    const ips = [];

    for (const domainName of seedDomains) {
        const sourceIps = await fetchDoHARecords(domainName);
        const sourceName = "local_dns";

        const cfIps = uniqueIPv4List(sourceIps.filter(isCloudflareIPv4));
        if (cfIps.length > 0) {
            validSeedDomains.push(domainName);
            ips.push(...cfIps);
            console.log(`  ✓ ${sourceName}: ${cfIps.length} CF IPs`);
        } else {
            invalidSeedDomains.push(domainName);
            console.log(`  → No CF IPs found (${sourceName})`);
        }

        await new Promise(resolve => setTimeout(resolve, 350));
    }

    return {
        validSeedDomains,
        invalidSeedDomains,
        ips: uniqueIPv4List(ips).slice(0, MAX_IPS),
        stats: {
            localDnsQueries: seedDomains.length,
            localDnsHits: validSeedDomains.length,
            localDnsMisses: invalidSeedDomains.length
        }
    };
}

async function runSingleProbe(ipAddress, hostName, pathName) {
    const begin = Date.now();
    const url = `http://${ipAddress}${pathName}`;
    const headers = { "Host": hostName, "User-Agent": "Loon-CF-Hybrid" };
    return new Promise(resolve => {
        $httpClient.get({ url, headers, timeout: PROBE_TIMEOUT, node: "DIRECT", "binary-mode": true }, (err, resp, data) => {
            if (err || !resp || Number(resp.status || 0) >= 500 || !data) {
                resolve({ ok: false, kbps: 0 });
                return;
            }
            const elapsedMs = Math.max(1, Date.now() - begin);
            const bytes = typeof data === "string" ? data.length : 0;
            const kbps = Math.round((bytes / 1024) / (elapsedMs / 1000));
            resolve({ ok: Number(resp.status || 0) < 500, kbps });
        });
    });
}

async function runProbe(ipAddress, hostName) {
    const paths = normalizeProbePathList(PROBE_PATH);
    if (!paths.length) return null;
    const results = await Promise.all(paths.map(pathName => runSingleProbe(ipAddress, hostName, pathName)));
    return results.reduce((best, result) => {
        if (!best || result.kbps > best.kbps) return result;
        return best;
    }, null);
}

function ping(ipAddress, hostName) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const url = `http://${ipAddress}/cdn-cgi/trace`;
        const headers = { "Host": hostName, "User-Agent": "Loon-CF-Hybrid" };
        $httpClient.get({ url, headers, timeout: Math.max(1500, Math.min(4000, PROBE_TIMEOUT)), node: "DIRECT" }, (err, resp) => {
            if (err || !resp || Number(resp.status || 0) >= 500) {
                resolve({ ip: ipAddress, delay: 9999 });
                return;
            }
            resolve({ ip: ipAddress, delay: Date.now() - startedAt });
        });
    });
}

async function samplePing(ipAddress, hostName) {
    const tasks = [];
    for (let index = 0; index < PING_SAMPLES; index += 1) {
        tasks.push(new Promise(resolve => setTimeout(() => resolve(ping(ipAddress, hostName)), index * 90)));
    }
    const results = await Promise.all(tasks);
    const validDelays = results.filter(result => result.delay < 9999).map(result => result.delay);
    const stats = calcStats(validDelays);
    return {
        ip: ipAddress,
        delay: stats.avg,
        jitter: stats.jitter,
        successRate: Number(stats.successRate.toFixed(2)),
        score: calcScore(stats),
        probeKbps: null
    };
}

async function evaluateCandidates(candidates, hostName) {
    const aggregate = new Map();
    for (let round = 0; round < EVAL_ROUNDS; round += 1) {
        const roundResults = await Promise.all(candidates.map(ipAddress => samplePing(ipAddress, hostName)));
        for (const row of roundResults) {
            const current = aggregate.get(row.ip) || { delay: 0, jitter: 0, successRate: 0, score: 0, count: 0 };
            current.delay += row.delay;
            current.jitter += row.jitter;
            current.successRate += row.successRate;
            current.score += row.score;
            current.count += 1;
            aggregate.set(row.ip, current);
        }
    }

    const base = [...aggregate.entries()].map(([ip, value]) => ({
        ip,
        delay: Math.round(value.delay / value.count),
        jitter: Math.round(value.jitter / value.count),
        successRate: Number((value.successRate / value.count).toFixed(2)),
        score: Math.round(value.score / value.count),
        probeKbps: null
    }));

    if (!PROBE_PATH) return base;

    const probeTargets = base.slice(0, Math.min(10, base.length));
    const probeResults = await Promise.all(probeTargets.map(async row => ({
        ip: row.ip,
        probe: await runProbe(row.ip, hostName)
    })));

    const probeMap = new Map(probeResults.map(item => [item.ip, item.probe]));
    return base.map(row => {
        const probe = probeMap.get(row.ip);
        if (!probe) return row;
        const kbps = Number.isFinite(probe.kbps) ? probe.kbps : 0;
        return {
            ...row,
            probeKbps: kbps,
            score: row.score + Math.max(0, MIN_PROBE_KBPS - kbps)
        };
    });
}

function buildMappingSuggestion(bestIp, targets) {
    return targets.map(domainName => ({
        domain: domainName,
        ip: bestIp,
        host: `${domainName} = ${bestIp}`
    }));
}

function buildPluginSnippet(bestIp, targets) {
    const lines = targets.map(domainName => `${domainName} = ${bestIp}`);
    return [
        "[Host]",
        ...lines,
        ""
    ].join("\n");
}

function buildHostSnippet(bestIp, targets) {
    return targets.map(domainName => `${domainName} = ${bestIp}`).join("\n");
}

function buildGeneratedPlugin(bestIp, targets) {
    const hostLines = targets.map(domainName => `${domainName} = ${bestIp}`).join("\n");
    return [
        "#!name=CF_HostMap",
        "#!desc=由 CF 混合优选脚本自动生成",
        "#!author=@LoonMaster-Engine",
        "#!icon=https://img.icons8.com/fluency/96/refresh.png",
        "#!system=ios",
        "",
        "[Host]",
        hostLines,
        ""
    ].join("\n");
}

async function syncBestToGist(bestIp, targets) {
    if (!hasValidGistAuth()) {
        console.log("ℹ️ 未配置 GitHub Token/Gist ID，跳过自动写入 Gist。仅保留本地结果。");
        return false;
    }

    const hostContent = buildHostSnippet(bestIp, targets);
    const pluginContent = buildGeneratedPlugin(bestIp, targets);
    const content = OUTPUT_MODE === "host" ? hostContent : pluginContent;

    const payload = {
        files: {
            [GIST_FILENAME]: {
                content
            }
        }
    };

    const headers = {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "Loon-CF-Hybrid"
    };

    return new Promise(resolve => {
        $httpClient.patch(
            {
                url: `https://api.github.com/gists/${GIST_ID}`,
                headers,
                body: JSON.stringify(payload),
                timeout: 7000,
                node: "DIRECT"
            },
            (err, resp) => {
                if (err || !resp || Number(resp.status || 0) >= 300) {
                    console.log(`❌ Gist 写入失败: ${err || `HTTP ${resp ? resp.status : 0}`}`);
                    resolve(false);
                    return;
                }
                console.log(`✅ Gist 写入成功: ${GIST_FILENAME}`);
                resolve(true);
            }
        );
    });
}

async function main() {
    console.log("🔄 CF 混合优选采集器已启动");

    const targetDomains = parseDomainList(TARGET_DOMAINS_RAW);
    if (!targetDomains.length || isPlaceholder(TARGET_DOMAINS_RAW)) {
        console.log("❌ CF_TARGET_DOMAINS 未设置，请填写你的反代域名后再运行。");
        $notification.post({
            title: "❌ 缺少目标域名",
            message: "请在插件参数中填写 CF_TARGET_DOMAINS（你的反代域名）",
            sound: "default"
        });
        $done();
        return;
    }

    const seedDomains = parseDomainList(SEED_DOMAINS_RAW);
    console.log("🚀 开始执行：云端种子池 + 本地采集 + 本地大比拼");
    console.log(`🎯 目标域名: ${targetDomains.join("，")}`);
    if (!PROBE_PATH) {
        console.log("ℹ️ 未配置业务探针路径，当前仅按延迟/抖动/成功率评分。");
    }

    const remoteSeedPool = await fetchRemoteSeedPool(SEED_POOL_URL);
    const remoteIps = remoteSeedPool ? remoteSeedPool.ips.filter(isCloudflareIPv4) : [];
    console.log(`☁️ 云端种子池: ${remoteIps.length} 个IP`);

    const localSeedResult = await collectLocalSeedIPs(seedDomains);
    console.log(`📱 本地采集: 有效=${localSeedResult.validSeedDomains.length} 无效=${localSeedResult.invalidSeedDomains.length} IP=${localSeedResult.ips.length}`);
    console.log(`📊 本地DNS状态: 查询=${localSeedResult.stats.localDnsQueries} 命中=${localSeedResult.stats.localDnsHits} 未命中=${localSeedResult.stats.localDnsMisses}`);

    const targetDnsIps = [];
    const validTargetDomains = [];
    const invalidTargetDomains = [];
    for (const domainName of targetDomains) {
        const ips = await fetchDoHARecords(domainName);
        const cfIps = ips.filter(isCloudflareIPv4);
        if (cfIps.length) {
            validTargetDomains.push(domainName);
            targetDnsIps.push(...cfIps);
        } else {
            invalidTargetDomains.push(domainName);
        }
    }

    if (!validTargetDomains.length) {
        console.log("❌ 你填写的目标域名没有解析到 Cloudflare IP，已跳过 host 映射。");
        $notification.post({
            title: "⚠️ 目标域名不是 CF 域名",
            message: "未检测到 Cloudflare 解析结果，已停止 host 映射",
            sound: "default"
        });
        $done();
        return;
    }

    const candidatePool = uniqueIPv4List([
        ...remoteIps,
        ...localSeedResult.ips,
        ...targetDnsIps
    ]).slice(0, CANDIDATE_LIMIT);

    if (!candidatePool.length) {
        console.log("❌ candidatePool 为空，无法进行本地大比拼。");
        $notification.post({
            title: "❌ 候选池为空",
            message: "云端和本地都没有拿到可用 CF IP，请检查网络/订阅",
            sound: "default"
        });
        $done();
        return;
    }

    console.log(`🏁 候选池就绪: ${candidatePool.length} 个IP`);

    const perDomainRanking = [];
    for (const domainName of validTargetDomains) {
        const rows = await evaluateCandidates(candidatePool, domainName);
        perDomainRanking.push({ domainName, rows: rows.slice(0, 12) });
        const top = rows[0] || null;
        if (top) {
            console.log(`✅ ${domainName} 第一名 => ${top.ip} | 延迟=${top.delay}ms 评分=${top.score}`);
        }
    }

    const mergedScore = new Map();
    for (const report of perDomainRanking) {
        for (const row of report.rows) {
            const current = mergedScore.get(row.ip) || { scoreSum: 0, delaySum: 0, jitterSum: 0, successSum: 0, probeSum: 0, probeCount: 0, count: 0 };
            current.scoreSum += row.score;
            current.delaySum += row.delay;
            current.jitterSum += row.jitter;
            current.successSum += row.successRate;
            if (typeof row.probeKbps === "number" && row.probeKbps > 0) {
                current.probeSum += row.probeKbps;
                current.probeCount += 1;
            }
            current.count += 1;
            mergedScore.set(row.ip, current);
        }
    }

    const finalRanking = [...mergedScore.entries()].map(([ip, value]) => ({
        ip,
        score: Math.round(value.scoreSum / value.count),
        delay: Math.round(value.delaySum / value.count),
        jitter: Math.round(value.jitterSum / value.count),
        successRate: Number((value.successSum / value.count).toFixed(2)),
        probeKbps: value.probeCount ? Math.round(value.probeSum / value.probeCount) : null
    })).sort((a, b) => a.score - b.score);

    const best = finalRanking[0];
    const mappingSuggestion = buildMappingSuggestion(best.ip, validTargetDomains);
    const pluginSnippet = buildPluginSnippet(best.ip, validTargetDomains);
    const hostSnippet = buildHostSnippet(best.ip, validTargetDomains);

    const gistSynced = await syncBestToGist(best.ip, validTargetDomains);

    const output = {
        seed_domains: seedDomains,
        valid_seed_domains: localSeedResult.validSeedDomains,
        invalid_seed_domains: localSeedResult.invalidSeedDomains,
        ips: uniqueIPv4List([...remoteIps, ...localSeedResult.ips]).slice(0, MAX_IPS),
        updated_at: Math.floor(Date.now() / 1000),
        source: "loon-hybrid-harvester",
        extended: {
            strategies: ["cloud_seed_pool", "local_dns", "local_benchmark"],
            harvest_method: "hybrid_cloud_local",
            target_domains: targetDomains,
            valid_target_domains: validTargetDomains,
            invalid_target_domains: invalidTargetDomains,
            candidate_pool_size: candidatePool.length,
            local_stats: localSeedResult.stats,
            cloud_seed_count: remoteIps.length,
            target_dns_cf_count: targetDnsIps.length,
            final_best: best,
            final_ranking_top10: finalRanking.slice(0, 10),
            mapping_suggestion: mappingSuggestion,
            gist_snippet_host: hostSnippet,
            gist_snippet_plugin: pluginSnippet,
            gist_file: GIST_FILENAME,
            output_mode: OUTPUT_MODE,
            gist_synced: gistSynced
        }
    };

    const outputJson = JSON.stringify(output, null, 2);
    console.log(`\n📋 hybrid_result.json content:\n${outputJson}\n`);
    console.log("📋 Gist Host 片段:");
    console.log(output.extended.gist_snippet_host);
    console.log("\n📋 Gist Plugin 片段:");
    console.log(output.extended.gist_snippet_plugin);

    try {
        $persistentStore.write(outputJson, STORE_RESULT_KEY);
        $persistentStore.write(JSON.stringify({
            updated_at: output.updated_at,
            target_domains: targetDomains,
            best
        }), STORE_BEST_KEY);
    } catch (error) {
        console.log(`⚠️ 本地缓存写入失败: ${error.message}`);
    }

    $notification.post({
        title: "✅ CF 本地大比拼完成",
        message: `${targetDomains[0]} -> ${best.ip} (${best.delay}ms, 评分=${best.score})`,
        sound: "default"
    });

    console.log("🏁 执行完成");
    $done();
}

main().catch(error => {
    console.log(`❌ 致命错误: ${error.message}`);
    $notification.post({
        title: "❌ CF 混合优选失败",
        message: error.message,
        sound: "default"
    });
    $done();
});
