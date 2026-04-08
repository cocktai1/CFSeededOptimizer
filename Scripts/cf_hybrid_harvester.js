// Hybrid CF Harvester for Loon (Cloud + Local + Final Local Competition)
// 目标：融合云端 seed_pool 与本地实时采集，在本地做大比拼，给出反代域名最佳 IP。

const ARG = (typeof $argument === "object" && $argument !== null) ? $argument : {};
const isPlaceholder = (value) => typeof value === "string" && /^\{.+\}$/.test(value.trim());
const SCRIPT_VERSION = "2026-04-09.v11";

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
const EXTRA_DOMAINS_RAW = String(ARG.CF_EXTRA_DOMAINS || "").trim();
const SEED_POOL_URL = String(ARG.CF_SEED_POOL_URL || "https://raw.githubusercontent.com/cocktai1/CFSeededOptimizer/refs/heads/main/data/seed_pool.json").trim();
const GITHUB_TOKEN = String(ARG.CF_TOKEN || "").trim();
const GIST_ID = String(ARG.CF_GIST_ID || "").trim();
const GIST_FILENAME_RAW = String(ARG.CF_GIST_FILE || "CF_HostMap").trim();
const OUTPUT_MODE = String(ARG.CF_OUTPUT_MODE || "plugin").trim().toLowerCase();
const GIST_FILENAME = normalizeGistFilename(GIST_FILENAME_RAW, OUTPUT_MODE);
const GIST_FILENAME_CANDIDATES = buildGistFilenameCandidates(GIST_FILENAME_RAW, OUTPUT_MODE, GIST_FILENAME);
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
const EVAL_CONCURRENCY = Math.min(8, Math.max(2, Number.parseInt(String(ARG.CF_EVAL_CONCURRENCY || "4"), 10) || 4));
const DNS_QUERY_CONCURRENCY = Math.min(8, Math.max(2, Number.parseInt(String(ARG.CF_DNS_CONCURRENCY || "4"), 10) || 4));
const STRICT_ACCESS_MODE = String(ARG.CF_STRICT_ACCESS_MODE || "on").trim().toLowerCase();
const ON_FAIL_STRATEGY = String(ARG.CF_ON_FAIL_STRATEGY || "keep_current").trim().toLowerCase();
const ACCESS_CHECK_PATHS_RAW = String(ARG.CF_ACCESS_CHECK_PATHS || "/cdn-cgi/trace").trim();

const STORE_RESULT_KEY = "CF_HYBRID_HARVEST_RESULT";
const STORE_BEST_KEY = "CF_LOCAL_BEST_IP_RESULT";
const DNS_CACHE = new Map();

function notify(title, subtitle, message, options) {
    const t = String(title || "");
    const s = String(subtitle || "");
    const m = String(message || "");
    try {
        if (options && typeof options === "object") {
            $notification.post(t, s, m, options);
            return;
        }
        $notification.post(t, s, m);
    } catch (error) {
        try {
            $notification.post(t, s, m);
        } catch (_) {
            // ignore notification failures
        }
    }
}

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

function normalizeGistFilename(rawName, outputMode) {
    const fallback = "CF_HostMap";
    const safeName = String(rawName || "").trim() || fallback;
    if (String(outputMode || "").toLowerCase() === "plugin" && safeName.toLowerCase().endsWith(".plugin")) {
        return safeName.slice(0, -7) || fallback;
    }
    return safeName;
}

function buildGistFilenameCandidates(rawName, outputMode, normalizedName) {
    const names = new Set();
    const raw = String(rawName || "").trim();
    const normalized = String(normalizedName || "").trim();

    if (normalized) names.add(normalized);
    if (raw) names.add(raw);

    if (String(outputMode || "").toLowerCase() === "plugin") {
        if (raw && raw.toLowerCase().endsWith(".plugin")) {
            names.add(raw.slice(0, -7));
        } else if (raw) {
            names.add(`${raw}.plugin`);
        }

        if (normalized && !normalized.toLowerCase().endsWith(".plugin")) {
            names.add(`${normalized}.plugin`);
        }
    }

    return [...names].filter(Boolean);
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

function normalizeAccessCheckPaths(value) {
    const paths = normalizeProbePathList(value);
    return paths.length ? paths : ["/cdn-cgi/trace"];
}

function responseLooksBlocked(statusCode, bodyText, strictMode) {
    const status = Number(statusCode || 0);
    const text = String(bodyText || "").toLowerCase();
    if (text.includes("error 1034") || text.includes("edge ip restricted")) return true;
    if (strictMode && status >= 400) return true;
    if (!strictMode && status >= 500) return true;
    return false;
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
    const normalized = normalizeDomainToken(domainName);
    if (!normalized) return [];
    if (DNS_CACHE.has(normalized)) {
        return DNS_CACHE.get(normalized);
    }

    const endpoints = [
        {
            name: "alidns",
            url: `https://dns.alidns.com/resolve?name=${encodeURIComponent(normalized)}&type=A`,
            headers: { "Accept": "application/dns-json", "User-Agent": "Loon" }
        },
        {
            name: "cloudflare-dns",
            url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(normalized)}&type=A`,
            headers: { "Accept": "application/dns-json", "User-Agent": "Loon" }
        },
        {
            name: "dns-google",
            url: `https://dns.google/resolve?name=${encodeURIComponent(normalized)}&type=A`,
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
    const merged = uniqueIPv4List(results.flat());
    DNS_CACHE.set(normalized, merged);
    return merged;
}

async function collectLocalSeedIPs(seedDomains) {
    const reports = await mapWithConcurrency(seedDomains, DNS_QUERY_CONCURRENCY, async (domainName) => {
        const sourceIps = await fetchDoHARecords(domainName);
        const cfIps = uniqueIPv4List(sourceIps.filter(isCloudflareIPv4));
        return { domainName, cfIps };
    });

    const validSeedDomains = reports.filter(item => item.cfIps.length > 0).map(item => item.domainName);
    const invalidSeedDomains = reports.filter(item => item.cfIps.length === 0).map(item => item.domainName);
    const ips = reports.flatMap(item => item.cfIps);

    reports.forEach(item => {
        if (item.cfIps.length > 0) {
            console.log(`  ✓ local_dns: ${item.cfIps.length} CF IPs`);
        } else {
            console.log("  → No CF IPs found (local_dns)");
        }
    });

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
            const status = Number(resp && resp.status ? resp.status : 0);
            const bodyText = typeof data === "string" ? data : "";
            if (err || !resp || responseLooksBlocked(status, bodyText, true) || !data) {
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

function calcStats(delays) {
    if (!delays.length) {
        return { avg: 9999, jitter: 9999, successRate: 0 };
    }

    const avg = delays.reduce((sum, delay) => sum + delay, 0) / delays.length;
    const maxDelay = Math.max(...delays);
    const minDelay = Math.min(...delays);

    return {
        avg: Math.round(avg),
        jitter: Math.round(maxDelay - minDelay),
        successRate: delays.length / PING_SAMPLES
    };
}

function calcScore(metrics) {
    const lossPenalty = Math.round((1 - metrics.successRate) * 900);
    return Math.round(metrics.avg + metrics.jitter * JITTER_WEIGHT + lossPenalty);
}

async function mapWithConcurrency(items, concurrency, worker) {
    const size = Math.max(1, Math.min(concurrency, items.length || 1));
    const results = new Array(items.length);
    let cursor = 0;

    const runners = Array.from({ length: size }, async () => {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    });

    await Promise.all(runners);
    return results;
}

function ping(ipAddress, hostName) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const url = `http://${ipAddress}/cdn-cgi/trace`;
        const headers = { "Host": hostName, "User-Agent": "Loon-CF-Hybrid" };
        $httpClient.get({ url, headers, timeout: Math.max(1500, Math.min(4000, PROBE_TIMEOUT)), node: "DIRECT" }, (err, resp, data) => {
            const status = Number(resp && resp.status ? resp.status : 0);
            const bodyText = typeof data === "string" ? data : "";
            if (err || !resp || responseLooksBlocked(status, bodyText, true)) {
                resolve({ ip: ipAddress, delay: 9999 });
                return;
            }
            resolve({ ip: ipAddress, delay: Date.now() - startedAt });
        });
    });
}

async function verifyIpAccessibleForDomain(ipAddress, domainName, strictMode) {
    const checks = normalizeAccessCheckPaths(ACCESS_CHECK_PATHS_RAW);
    let lastFailure = { ok: false, reason: "network_error" };
    for (const pathName of checks) {
        const url = `http://${ipAddress}${pathName}`;
        const headers = { "Host": domainName, "User-Agent": "Loon-CF-Hybrid" };
        const result = await new Promise(resolve => {
            $httpClient.get({ url, headers, timeout: Math.max(2000, Math.min(5000, PROBE_TIMEOUT)), node: "DIRECT" }, (err, resp, data) => {
                if (err || !resp) {
                    resolve({ ok: false, reason: "network_error" });
                    return;
                }
                const status = Number(resp.status || 0);
                const bodyText = typeof data === "string" ? data : "";
                const text = String(bodyText || "").toLowerCase();
                if (text.includes("error 1034") || text.includes("edge ip restricted")) {
                    resolve({ ok: false, reason: "edge_ip_restricted_1034" });
                    return;
                }
                if (responseLooksBlocked(status, bodyText, strictMode)) {
                    resolve({ ok: false, reason: `http_${status}` });
                    return;
                }
                resolve({ ok: true, reason: "ok" });
            });
        });
        if (result.ok) return result;
        lastFailure = result;
        if (result.reason === "edge_ip_restricted_1034") return result;
    }
    return lastFailure;
}

async function verifyIpAccessibleForDomains(ipAddress, domains) {
    for (const domainName of domains) {
        const result = await verifyIpAccessibleForDomain(ipAddress, domainName, true);
        if (!result.ok) return false;
    }
    return true;
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
        const roundResults = await mapWithConcurrency(candidates, EVAL_CONCURRENCY, (ipAddress) => samplePing(ipAddress, hostName));
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

    base.sort((a, b) => a.score - b.score);

    if (!PROBE_PATH) return base;

    const probeTargets = base.slice(0, Math.min(10, base.length));
    const probeResults = await Promise.all(probeTargets.map(async row => ({
        ip: row.ip,
        probe: await runProbe(row.ip, hostName)
    })));

    const probeMap = new Map(probeResults.map(item => [item.ip, item.probe]));
    const scored = base.map(row => {
        const probe = probeMap.get(row.ip);
        if (!probe) return row;
        const kbps = Number.isFinite(probe.kbps) ? probe.kbps : 0;
        return {
            ...row,
            probeKbps: kbps,
            score: row.score + Math.max(0, MIN_PROBE_KBPS - kbps)
        };
    });

    scored.sort((a, b) => a.score - b.score);
    return scored;
}

function buildMappingSuggestion(mappings) {
    return mappings.map(item => ({
        domain: item.domain,
        ip: item.ip,
        source: item.source,
        host: `${item.domain} = ${item.ip}`
    }));
}

function buildPluginSnippet(mappings) {
    const lines = mappings.map(item => `${item.domain} = ${item.ip}, use-in-proxy=true`);
    return [
        "[Host]",
        ...lines,
        ""
    ].join("\n");
}

function buildHostSnippet(mappings) {
    return mappings.map(item => `${item.domain} = ${item.ip}`).join("\n");
}

function buildGeneratedPlugin(mappings) {
    const hostLines = mappings.map(item => `${item.domain} = ${item.ip}, use-in-proxy=true`).join("\n");
    return [
        "#!name=CF_HostMap",
        "#!desc=由 CF 混合优选脚本自动生成",
        "#!author=cocktai1",
        "#!icon=https://img.icons8.com/fluency/96/refresh.png",
        "",
        "[Host]",
        hostLines,
        ""
    ].join("\n");
}

async function syncBestToGist(mappings) {
    if (!hasValidGistAuth()) {
        console.log("ℹ️ 未配置 GitHub Token/Gist ID，跳过自动写入 Gist。仅保留本地结果。");
        return false;
    }

    const hostContent = buildHostSnippet(mappings);
    const pluginContent = buildGeneratedPlugin(mappings);
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

function parseHostMapContent(content) {
    const result = {};
    const lines = String(content || "").split(/\r?\n/);
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#") || line.startsWith("[")) continue;
        if (!line.includes("=")) continue;
        const [left, rightRaw] = line.split("=");
        const domain = normalizeDomainToken(left);
        const right = String(rightRaw || "").trim();
        const ipToken = right.split(",")[0].trim();
        if (!domain || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ipToken)) continue;
        result[domain] = ipToken;
    }
    return result;
}

async function fetchCurrentGistHostMap() {
    if (!hasValidGistAuth()) return null;
    const headers = {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "Loon-CF-Hybrid"
    };
    return new Promise(resolve => {
        $httpClient.get(
            {
                url: `https://api.github.com/gists/${GIST_ID}`,
                headers,
                timeout: 6000,
                node: "DIRECT"
            },
            (err, resp, data) => {
                if (err || !resp || Number(resp.status || 0) >= 300 || !data) {
                    resolve(null);
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    const files = json && json.files ? json.files : {};
                    for (const fileName of GIST_FILENAME_CANDIDATES) {
                        const fileNode = files[fileName];
                        const content = fileNode && typeof fileNode.content === "string" ? fileNode.content : "";
                        if (!content) continue;
                        const parsed = parseHostMapContent(content);
                        if (Object.keys(parsed).length > 0) {
                            if (fileName !== GIST_FILENAME) {
                                console.log(`ℹ️ 当前HostMap基线来源: ${fileName}（兼容读取）`);
                            }
                            resolve(parsed);
                            return;
                        }
                    }
                    resolve(null);
                } catch (error) {
                    resolve(null);
                }
            }
        );
    });
}

async function evaluateSingleIpAcrossDomains(ipAddress, domains) {
    const rows = await Promise.all(domains.map(async (domainName) => {
        const sampled = await samplePing(ipAddress, domainName);
        let probeKbps = null;
        let score = sampled.score;
        if (PROBE_PATH) {
            const probe = await runProbe(ipAddress, domainName);
            if (probe && Number.isFinite(probe.kbps)) {
                probeKbps = probe.kbps;
                score += Math.max(0, MIN_PROBE_KBPS - probe.kbps);
            }
        }
        return {
            delay: sampled.delay,
            jitter: sampled.jitter,
            successRate: sampled.successRate,
            score,
            probeKbps
        };
    }));

    const count = Math.max(1, rows.length);
    const probeRows = rows.filter(r => typeof r.probeKbps === "number");
    return {
        ip: ipAddress,
        score: Math.round(rows.reduce((sum, r) => sum + r.score, 0) / count),
        delay: Math.round(rows.reduce((sum, r) => sum + r.delay, 0) / count),
        jitter: Math.round(rows.reduce((sum, r) => sum + r.jitter, 0) / count),
        successRate: Number((rows.reduce((sum, r) => sum + r.successRate, 0) / count).toFixed(2)),
        probeKbps: probeRows.length ? Math.round(probeRows.reduce((sum, r) => sum + r.probeKbps, 0) / probeRows.length) : null
    };
}

function formatDelta(msValue) {
    if (typeof msValue !== "number" || !Number.isFinite(msValue)) return "n/a";
    const sign = msValue > 0 ? "+" : "";
    return `${sign}${msValue}ms`;
}

async function main() {
    console.log(`🔄 CF 混合优选采集器已启动 (script=${SCRIPT_VERSION})`);

    const targetDomains = parseDomainList(TARGET_DOMAINS_RAW);
    if (!targetDomains.length || isPlaceholder(TARGET_DOMAINS_RAW)) {
        console.log("❌ CF_TARGET_DOMAINS 未设置，请填写你的反代域名后再运行。");
        notify("❌ 缺少目标域名", "参数未配置", "请在插件参数中填写 CF_TARGET_DOMAINS（你的反代域名）");
        $done();
        return;
    }

    const seedDomains = parseDomainList(SEED_DOMAINS_RAW);
    const extraDomains = parseDomainList(EXTRA_DOMAINS_RAW);
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

    const extraDomainDiagnostics = [];
    const extraDomainIps = [];
    if (extraDomains.length) {
        const extraReports = await mapWithConcurrency(extraDomains, DNS_QUERY_CONCURRENCY, async (domainName) => {
            const ips = await fetchDoHARecords(domainName);
            const cfIps = uniqueIPv4List(ips.filter(isCloudflareIPv4));
            return { domainName, ips, cfIps };
        });
        for (const item of extraReports) {
            if (item.cfIps.length > 0) {
                extraDomainIps.push(...item.cfIps);
                extraDomainDiagnostics.push({ domain: item.domainName, status: "valid", reason: "cf_a_record_found", dnsA: item.ips.length, cfA: item.cfIps.length });
            } else {
                extraDomainDiagnostics.push({ domain: item.domainName, status: "invalid", reason: item.ips.length ? "not_cloudflare" : "no_a_record_or_dns_failed", dnsA: item.ips.length, cfA: 0 });
            }
        }
        const extraValid = extraDomainDiagnostics.filter(item => item.status === "valid").length;
        console.log(`🧩 扩展域名池: 总数=${extraDomains.length} 有效=${extraValid} 候选IP=${uniqueIPv4List(extraDomainIps).length}`);
    }

    const targetDnsIps = [];
    const targetDnsByDomain = new Map();
    const validTargetDomains = [];
    const invalidTargetDomains = [];
    const targetDomainDiagnostics = [];
    for (const domainName of targetDomains) {
        const ips = await fetchDoHARecords(domainName);
        const cfIps = ips.filter(isCloudflareIPv4);
        targetDnsByDomain.set(domainName, cfIps);
        if (cfIps.length) {
            validTargetDomains.push(domainName);
            targetDnsIps.push(...cfIps);
            targetDomainDiagnostics.push({ domain: domainName, status: "valid", reason: "cf_a_record_found", dnsA: ips.length, cfA: cfIps.length });
        } else {
            invalidTargetDomains.push(domainName);
            const reason = ips.length ? "not_cloudflare" : "no_a_record_or_dns_failed";
            targetDomainDiagnostics.push({ domain: domainName, status: "invalid", reason, dnsA: ips.length, cfA: 0 });
        }
    }

    if (!validTargetDomains.length) {
        console.log("❌ 你填写的目标域名没有解析到 Cloudflare IP，已跳过 host 映射。");
        notify("⚠️ 目标域名不是 CF 域名", "已停止映射更新", "未检测到 Cloudflare 解析结果");
        $done();
        return;
    }

    const candidatePool = uniqueIPv4List([
        ...remoteIps,
        ...localSeedResult.ips,
        ...extraDomainIps,
        ...targetDnsIps
    ]).slice(0, CANDIDATE_LIMIT);

    if (!candidatePool.length) {
        console.log("❌ candidatePool 为空，无法进行本地大比拼。");
        notify("❌ 候选池为空", "无法执行优选", "云端和本地都没有拿到可用 CF IP，请检查网络/订阅");
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

    const strictAccess = STRICT_ACCESS_MODE === "on" || STRICT_ACCESS_MODE === "true" || STRICT_ACCESS_MODE === "1";
    const onFailStrategy = ["abort", "keep_current", "skip_domain"].includes(ON_FAIL_STRATEGY) ? ON_FAIL_STRATEGY : "keep_current";
    console.log(`🛡️ 可访问性策略: strict=${strictAccess ? "on" : "off"}, on_fail=${onFailStrategy}`);

    const currentHostMap = await fetchCurrentGistHostMap();
    const selectedMappings = [];
    const domainComparisons = [];
    const rejectedOptions = [];
    const failedDomains = [];

    for (const domainName of validTargetDomains) {
        const report = perDomainRanking.find(item => item.domainName === domainName);
        const rows = report ? report.rows : [];
        const hybridBest = rows.length ? rows[0] : null;
        const dnsSet = new Set((targetDnsByDomain.get(domainName) || []).map(ip => String(ip)));
        const dnsBaseline = rows.find(row => dnsSet.has(String(row.ip))) || null;

        const currentMappedIp = currentHostMap ? currentHostMap[domainName] : null;
        let hostmapBaseline = null;
        if (currentMappedIp && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(currentMappedIp)) {
            hostmapBaseline = await evaluateSingleIpAcrossDomains(currentMappedIp, [domainName]);
        }

        const options = [];
        const seenOptionIps = new Set();
        const pushOption = (source, row) => {
            const ipAddress = row && row.ip ? String(row.ip) : "";
            if (!ipAddress || seenOptionIps.has(ipAddress)) return;
            seenOptionIps.add(ipAddress);
            options.push({ source, row });
        };

        rows.slice(0, 8).forEach((row, idx) => {
            pushOption(idx === 0 ? "hybrid_pool" : `hybrid_pool_rank_${idx + 1}`, row);
        });
        if (dnsBaseline) pushOption("dns_baseline", dnsBaseline);
        if (hostmapBaseline) pushOption("current_hostmap", hostmapBaseline);
        options.sort((a, b) => a.row.score - b.row.score);

        let selected = null;
        for (const option of options) {
            const ipAddress = option && option.row ? option.row.ip : "";
            if (!ipAddress) continue;
            const accessResult = await verifyIpAccessibleForDomain(ipAddress, domainName, strictAccess);
            if (accessResult.ok) {
                selected = option;
                break;
            }
            rejectedOptions.push({ domain: domainName, source: option.source, ip: ipAddress, reason: accessResult.reason || "access_blocked" });
        }

        if (!selected && onFailStrategy === "keep_current") {
            const keepIp = currentHostMap ? currentHostMap[domainName] : "";
            if (keepIp && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(keepIp)) {
                const keepCheck = await verifyIpAccessibleForDomain(keepIp, domainName, false);
                if (keepCheck.ok) {
                    const keepEval = await evaluateSingleIpAcrossDomains(keepIp, [domainName]);
                    selected = { source: "keep_current", row: keepEval };
                } else {
                    rejectedOptions.push({ domain: domainName, source: "keep_current", ip: keepIp, reason: keepCheck.reason || "access_blocked" });
                }
            }
        }

        if (selected) {
            selectedMappings.push({
                domain: domainName,
                ip: selected.row.ip,
                source: selected.source,
                delay: selected.row.delay,
                jitter: selected.row.jitter,
                score: selected.row.score,
                successRate: selected.row.successRate,
                probeKbps: selected.row.probeKbps
            });
        } else {
            failedDomains.push(domainName);
        }

        domainComparisons.push({
            domain: domainName,
            selected_source: selected ? selected.source : "none",
            selected: selected ? selected.row : null,
            hybrid_pool_best: hybridBest,
            dns_baseline: dnsBaseline,
            current_hostmap_baseline: hostmapBaseline,
            improved_ms_vs_hybrid_pool: selected && hybridBest ? (hybridBest.delay - selected.row.delay) : null,
            improved_ms_vs_dns: selected && dnsBaseline ? (dnsBaseline.delay - selected.row.delay) : null,
            improved_ms_vs_current_hostmap: selected && hostmapBaseline ? (hostmapBaseline.delay - selected.row.delay) : null,
            fallback_reason: selected ? null : "all_candidates_blocked_or_403_1034"
        });
    }

    if (!selectedMappings.length || (onFailStrategy === "abort" && failedDomains.length > 0)) {
        if (!selectedMappings.length) {
            console.log("❌ 所有域名候选IP均未通过可访问性校验，已停止写入，避免把不可访问IP写入HostMap。");
        } else {
            console.log(`❌ 因失败策略=abort，以下域名无可用IP，本轮停止写入: ${failedDomains.join(", ")}`);
        }
        if (rejectedOptions.length) {
            rejectedOptions.forEach(item => console.log(`  - ${item.domain} ${item.source} ${item.ip}: ${item.reason}`));
        }
        notify("⚠️ CF优选已拦截不可访问IP", "安全模式已生效", "候选IP触发403/1034等限制，已停止更新HostMap");
        $done();
        return;
    }

    if (failedDomains.length) {
        console.log(`⚠️ 以下域名未找到可写入候选，将按策略处理: ${failedDomains.join(", ")}`);
    }

    const selectedMappingsSorted = selectedMappings.slice().sort((a, b) => a.score - b.score);
    const overallBest = selectedMappingsSorted[0];

    const mappingSuggestion = buildMappingSuggestion(selectedMappingsSorted);
    const pluginSnippet = buildPluginSnippet(selectedMappingsSorted);
    const hostSnippet = buildHostSnippet(selectedMappingsSorted);

    const gistSynced = await syncBestToGist(selectedMappingsSorted);

    const output = {
        seed_domains: seedDomains,
        valid_seed_domains: localSeedResult.validSeedDomains,
        invalid_seed_domains: localSeedResult.invalidSeedDomains,
        ips: uniqueIPv4List([...candidatePool]).slice(0, MAX_IPS),
        updated_at: Math.floor(Date.now() / 1000),
        source: "loon-hybrid-harvester",
        extended: {
            strategies: ["cloud_seed_pool", "local_dns", "local_benchmark"],
            harvest_method: "hybrid_cloud_local",
            target_domains: targetDomains,
            valid_target_domains: validTargetDomains,
            invalid_target_domains: invalidTargetDomains,
            target_domain_diagnostics: targetDomainDiagnostics,
            extra_domains: extraDomains,
            extra_domain_diagnostics: extraDomainDiagnostics,
            candidate_pool_size: candidatePool.length,
            local_stats: localSeedResult.stats,
            access_policy: {
                strict_mode: strictAccess,
                on_fail_strategy: onFailStrategy,
                access_check_paths: normalizeAccessCheckPaths(ACCESS_CHECK_PATHS_RAW)
            },
            cloud_seed_count: remoteIps.length,
            target_dns_cf_count: targetDnsIps.length,
            final_best: overallBest,
            final_best_source: overallBest.source,
            comparison: {
                by_domain: domainComparisons,
                rejected_candidates: rejectedOptions
            },
            final_ranking_top10: finalRanking.slice(0, 10),
            selected_mappings: selectedMappingsSorted,
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

    console.log("\n┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("┃ 📌 本轮优选总结");
    console.log(`┃ 赢家来源: ${overallBest.source}`);
    console.log(`┃ 最终IP: ${overallBest.ip}`);
    console.log(`┃ 延迟/抖动/评分: ${overallBest.delay}ms / ${overallBest.jitter}ms / ${overallBest.score}`);
    console.log(`┃ 本轮生效域名数: ${selectedMappingsSorted.length}/${validTargetDomains.length}`);
    selectedMappingsSorted.forEach(item => {
        console.log(`┃ - ${item.domain} => ${item.ip} (${item.delay}ms, ${item.source})`);
    });
    if (failedDomains.length) {
        console.log(`┃ 未更新域名: ${failedDomains.join("，")}`);
    }
    if (invalidTargetDomains.length) {
        console.log("┃ 被淘汰域名:");
        for (const item of targetDomainDiagnostics.filter(d => d.status === "invalid")) {
            console.log(`┃ - ${item.domain} => ${item.reason} (dnsA=${item.dnsA}, cfA=${item.cfA})`);
        }
    }
    console.log("┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    try {
        $persistentStore.write(outputJson, STORE_RESULT_KEY);
        $persistentStore.write(JSON.stringify({
            updated_at: output.updated_at,
            target_domains: targetDomains,
            best: overallBest,
            best_source: overallBest.source,
            selected_mappings: selectedMappingsSorted
        }), STORE_BEST_KEY);
    } catch (error) {
        console.log(`⚠️ 本地缓存写入失败: ${error.message}`);
    }

    notify(
        "✅ CF 本地大比拼完成",
        `来源=${overallBest.source} | 生效域名=${selectedMappingsSorted.length}`,
        `${overallBest.ip} | ${overallBest.delay}ms | score=${overallBest.score}`
    );

    console.log("🏁 执行完成");
    $done();
}

main().catch(error => {
    console.log(`❌ 致命错误: ${error.message}`);
    notify("❌ CF 混合优选失败", "运行异常", error.message);
    $done();
});
