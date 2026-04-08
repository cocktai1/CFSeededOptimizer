// CF Seeded Optimizer
// 作用：先从稳定的 CF 种子域名喂候选池，再对你的目标域名做最终优选；目标域名变化时会自动清理旧映射。

const ARG = (typeof $argument === "object" && $argument !== null) ? $argument : {};
const isPlaceholder = (value) => typeof value === "string" && /^\{.+\}$/.test(value.trim());

const GITHUB_TOKEN = (ARG.CF_TOKEN || "").trim();
const GIST_ID = (ARG.CF_GIST_ID || "").trim();
const GIST_FILENAME = (ARG.CF_GIST_FILE || "CF_Seeded_HostMap.plugin").trim();
const GENERATED_ICON = (ARG.CF_GENERATED_ICON || "https://img.icons8.com/fluency/96/synchronize.png").trim();
const OUTPUT_MODE = ((ARG.CF_OUTPUT_MODE || "plugin") + "").trim().toLowerCase();
const USE_IN_PROXY = ((ARG.CF_USE_IN_PROXY || "on") + "").trim().toLowerCase();
const LOW_NOISE_MODE = ((ARG.CF_LOW_NOISE_MODE || "on") + "").trim().toLowerCase();
const AUTO_REFRESH_SUB = ((ARG.CF_AUTO_REFRESH_SUB || "on") + "").trim().toLowerCase();

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

const SEED_DOMAINS_RAW = (ARG.CF_SEED_DOMAINS || DEFAULT_SEED_DOMAINS.join("\n")).trim();
const TARGET_DOMAINS_RAW = (ARG.CF_TARGET_DOMAINS || "").trim();
const SEED_POOL_URL = (ARG.CF_SEED_POOL_URL || "https://raw.githubusercontent.com/cocktai1/CFSeededOptimizer/refs/heads/main/data/seed_pool.json").trim();

const MIN_IMPROVEMENT = Number.parseInt((ARG.CF_MIN_IMPROVEMENT || "100").trim(), 10) || 100;
const STICKY_MS = Number.parseInt((ARG.CF_STICKY_MS || "220").trim(), 10) || 220;
const MIN_SWITCH_MINUTES = Number.parseInt((ARG.CF_MIN_SWITCH_MINUTES || "480").trim(), 10) || 480;
const CANDIDATE_LIMIT = Math.min(120, Math.max(8, Number.parseInt((ARG.CF_CANDIDATE_LIMIT || "30").trim(), 10) || 30));
const SEED_POOL_LIMIT = Math.min(200, Math.max(10, Number.parseInt((ARG.CF_SEED_POOL_LIMIT || "80").trim(), 10) || 80));
const FALLBACK_TARGET_LIMIT = Math.min(24, Math.max(1, Number.parseInt((ARG.CF_FALLBACK_TARGET_LIMIT || "6").trim(), 10) || 6));
const MIN_VALID_SEED_DOMAINS = Math.min(24, Math.max(1, Number.parseInt((ARG.CF_MIN_VALID_SEED_DOMAINS || "2").trim(), 10) || 2));
const SEED_REFRESH_MINUTES = Math.min(10080, Math.max(30, Number.parseInt((ARG.CF_SEED_REFRESH_MINUTES || "720").trim(), 10) || 720));
const EVAL_ROUNDS = Math.min(5, Math.max(1, Number.parseInt((ARG.CF_EVAL_ROUNDS || "4").trim(), 10) || 4));
const PING_SAMPLES = Math.min(6, Math.max(2, Number.parseInt((ARG.CF_PING_SAMPLES || "5").trim(), 10) || 5));
const JITTER_WEIGHT = Number.parseFloat((ARG.CF_JITTER_WEIGHT || "0.9").trim()) || 0.9;
const REQUIRE_BEAT_DNS = ((ARG.CF_REQUIRE_BEAT_DNS || "on") + "").trim().toLowerCase();
const DNS_MARGIN_MS = Number.parseInt((ARG.CF_DNS_MARGIN_MS || "80").trim(), 10) || 80;
const MAX_ACCEPT_DELAY = Number.parseInt((ARG.CF_MAX_ACCEPT_DELAY || "650").trim(), 10) || 650;
const PROBE_PATH = (ARG.CF_PROBE_PATH || "").trim();
const PROBE_TIMEOUT = Number.parseInt((ARG.CF_PROBE_TIMEOUT || "6000").trim(), 10) || 6000;
const MIN_PROBE_KBPS = Number.parseInt((ARG.CF_MIN_PROBE_KBPS || "250").trim(), 10) || 250;
const BAD_RUN_PAUSE_MINUTES = Number.parseInt((ARG.CF_BAD_RUN_PAUSE_MINUTES || "20").trim(), 10) || 20;
const NOTIFY_COOLDOWN_MINUTES = Number.parseInt((ARG.CF_NOTIFY_COOLDOWN_MINUTES || "180").trim(), 10) || 180;

const SEED_CACHE_KEY = "CF_SEEDED_OPT_SEED_POOL_CACHE";
const SEED_CACHE_TS_KEY = "CF_SEEDED_OPT_SEED_POOL_UPDATED_AT";
const LAST_TARGETS_KEY = "CF_SEEDED_OPT_LAST_TARGETS";
const CURRENT_IP_KEY = "CF_SEEDED_OPT_CURRENT_IP";
const LAST_SWITCH_AT_KEY = "CF_SEEDED_OPT_LAST_SWITCH_AT";
const LAST_GIST_SYNC_AT_KEY = "CF_SEEDED_OPT_LAST_GIST_SYNC_AT";
const BAD_ROUND_COUNT_KEY = "CF_SEEDED_OPT_BAD_ROUND_COUNT";
const SWITCH_PAUSE_UNTIL_KEY = "CF_SEEDED_OPT_SWITCH_PAUSE_UNTIL";
const NOTIFY_TS_KEY = "CF_SEEDED_OPT_NOTIFY_LAST_TS";
const NOTIFY_FP_KEY = "CF_SEEDED_OPT_NOTIFY_LAST_FP";

if (typeof $argument === "undefined" || isPlaceholder(TARGET_DOMAINS_RAW)) {
    console.log("⚠️ 目标域名参数尚未生效：请在插件参数页填写真实值后再执行。");
    $done();
    return;
}

function parseDomainList(rawValue) {
    return Array.from(new Set(
        rawValue
            .split(/[\r\n,]+/)
            .map(item => item.trim().toLowerCase())
            .filter(Boolean)
    ));
}

function parseSeedPoolPayload(rawValue) {
    if (!rawValue) return null;
    try {
        const payload = JSON.parse(rawValue);
        const ips = Array.isArray(payload.ips) ? uniqueIPv4List(payload.ips) : [];
        const seedDomains = Array.isArray(payload.seed_domains)
            ? payload.seed_domains
            : (Array.isArray(payload.seedDomains) ? payload.seedDomains : []);
        const validSeedDomains = Array.isArray(payload.valid_seed_domains)
            ? payload.valid_seed_domains
            : (Array.isArray(payload.validSeeds) ? payload.validSeeds : []);
        const invalidSeedDomains = Array.isArray(payload.invalid_seed_domains)
            ? payload.invalid_seed_domains
            : (Array.isArray(payload.invalidSeeds) ? payload.invalidSeeds : []);
        const updatedAt = Number.parseInt(String(payload.updated_at || payload.updatedAt || "0"), 10) || 0;

        return {
            seedDomains: seedDomains.map(item => String(item).trim().toLowerCase()).filter(Boolean),
            validSeedDomains: validSeedDomains.map(item => String(item).trim().toLowerCase()).filter(Boolean),
            invalidSeedDomains: invalidSeedDomains.map(item => String(item).trim().toLowerCase()).filter(Boolean),
            ips,
            updatedAt,
            source: String(payload.source || "remote")
        };
    } catch (error) {
        return null;
    }
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

function uniqueIPv4List(items) {
    const seen = new Set();
    const result = [];
    for (const ipAddress of items) {
        if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ipAddress)) continue;
        if (seen.has(ipAddress)) continue;
        seen.add(ipAddress);
        result.push(ipAddress);
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
        if (base === null || Number.isNaN(prefixLength) || prefixLength < 0 || prefixLength > 32) {
            return null;
        }
        const mask = prefixLength === 0 ? 0 : ((0xffffffff << (32 - prefixLength)) >>> 0);
        return { base: (base & mask) >>> 0, mask };
    }).filter(Boolean);
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
    "198.41.128.0/17"
];

const CF_CIDR_ENTRIES = buildCidrEntries(CF_IPV4_CIDRS);

function isCloudflareIPv4(ipAddress) {
    const value = ipv4ToInt(ipAddress);
    if (value === null) return false;
    return CF_CIDR_ENTRIES.some(entry => ((value & entry.mask) >>> 0) === entry.base);
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
    return value
        .split(",")
        .map(part => normalizeProbePath(part.trim()))
        .filter(Boolean)
        .slice(0, 4);
}

async function fetchDnsResolvedIPs(domainName) {
    const endpoints = [
        {
            url: `https://dns.alidns.com/resolve?name=${encodeURIComponent(domainName)}&type=A`,
            headers: { "Accept": "application/dns-json", "User-Agent": "Loon" }
        },
        {
            url: `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domainName)}&type=A`,
            headers: { "Accept": "application/dns-json", "User-Agent": "Loon" }
        }
    ];

    const resultIps = [];
    for (const endpoint of endpoints) {
        const ips = await new Promise(resolve => {
            $httpClient.get({ url: endpoint.url, headers: endpoint.headers, timeout: 2500, node: "DIRECT" }, (err, resp, data) => {
                if (err || !resp || resp.status !== 200 || !data) {
                    resolve([]);
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    const answers = Array.isArray(json.Answer) ? json.Answer : [];
                    const parsed = answers.map(item => item && item.data ? String(item.data).trim() : "");
                    resolve(uniqueIPv4List(parsed));
                } catch (error) {
                    resolve([]);
                }
            });
        });
        resultIps.push(...ips);
    }

    return uniqueIPv4List(resultIps);
}

async function harvestSeedPool(seedDomains) {
    const reports = await Promise.all(seedDomains.map(async domainName => {
        const ips = await fetchDnsResolvedIPs(domainName);
        const cloudflareIps = ips.filter(isCloudflareIPv4);
        return {
            domainName,
            ips,
            cloudflareIps,
            valid: cloudflareIps.length > 0
        };
    }));

    return {
        validSeeds: reports.filter(item => item.valid).map(item => item.domainName),
        invalidSeeds: reports.filter(item => !item.valid).map(item => item.domainName),
        ips: uniqueIPv4List(reports.flatMap(item => item.cloudflareIps)).slice(0, SEED_POOL_LIMIT),
        updatedAt: Date.now()
    };
}

function readCacheJson(storageKey) {
    try {
        const rawValue = $persistentStore.read(storageKey) || "";
        if (!rawValue) return null;
        return JSON.parse(rawValue);
    } catch (error) {
        return null;
    }
}

function calcStats(delays) {
    if (!delays.length) return { avg: 9999, jitter: 9999, successRate: 0 };
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
    const penalty = Math.round((1 - metrics.successRate) * 900);
    return Math.round(metrics.avg + metrics.jitter * JITTER_WEIGHT + penalty);
}

function ping(ipAddress, hostName) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        const url = hostName ? `http://${ipAddress}/cdn-cgi/trace` : `https://${ipAddress}/cdn-cgi/trace`;
        const headers = hostName ? { "Host": hostName, "User-Agent": "Mozilla/5.0" } : {};
        $httpClient.get({ url, headers, timeout: Math.max(1500, Math.min(4000, MAX_ACCEPT_DELAY + 700)), node: "DIRECT" }, (err, resp) => {
            if (!err && resp && resp.status === 200) {
                resolve({ ip: ipAddress, delay: Date.now() - startedAt });
            } else {
                resolve({ ip: ipAddress, delay: 9999 });
            }
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

async function runSingleProbe(ipAddress, hostName, pathName) {
    if (!pathName) return null;
    const startedAt = Date.now();
    return new Promise(resolve => {
        const url = `http://${ipAddress}${pathName}`;
        const headers = { "Host": hostName, "User-Agent": "Mozilla/5.0" };
        $httpClient.get({ url, headers, timeout: PROBE_TIMEOUT, node: "DIRECT", "binary-mode": true }, (err, resp, data) => {
            if (err || !resp || resp.status < 200 || resp.status >= 400) {
                resolve({ kbps: 0, ok: false });
                return;
            }

            const elapsedSec = Math.max((Date.now() - startedAt) / 1000, 0.2);
            let bytes = 0;
            if (typeof data === "string") {
                bytes = data.length;
            } else if (data && typeof data.byteLength === "number") {
                bytes = data.byteLength;
            } else if (data && typeof data.length === "number") {
                bytes = data.length;
            }

            const kbps = Math.round((bytes / 1024) / elapsedSec);
            resolve({ kbps, ok: kbps > 0 });
        });
    });
}

async function runProbe(ipAddress, hostName) {
    const paths = normalizeProbePathList(PROBE_PATH);
    if (!paths.length) return null;

    const allResults = [];
    for (const pathName of paths) {
        const result = await runSingleProbe(ipAddress, hostName, pathName);
        if (result) allResults.push(result);
    }
    const okResults = allResults.filter(result => result.ok && result.kbps > 0);
    if (!okResults.length) return { kbps: 0, ok: false };
    const average = Math.round(okResults.reduce((sum, item) => sum + item.kbps, 0) / okResults.length);
    return { kbps: average, ok: true };
}

async function evaluateCandidates(candidates, hostName) {
    const aggregate = new Map();
    for (let roundIndex = 0; roundIndex < EVAL_ROUNDS; roundIndex += 1) {
        const roundResults = await Promise.all(candidates.map(ipAddress => samplePing(ipAddress, hostName)));
        for (const result of roundResults) {
            const current = aggregate.get(result.ip) || { delay: 0, jitter: 0, successRate: 0, score: 0, count: 0 };
            current.delay += result.delay;
            current.jitter += result.jitter;
            current.successRate += result.successRate;
            current.score += result.score;
            current.count += 1;
            aggregate.set(result.ip, current);
        }
    }

    const base = Array.from(aggregate.entries()).map(([ipAddress, value]) => ({
        ip: ipAddress,
        delay: Math.round(value.delay / value.count),
        jitter: Math.round(value.jitter / value.count),
        successRate: Number((value.successRate / value.count).toFixed(2)),
        score: Math.round(value.score / value.count),
        probeKbps: null
    }));

    base.sort((left, right) => left.score - right.score);

    if (!PROBE_PATH) return base;

    const top = base.slice(0, Math.min(6, base.length));
    for (const item of top) {
        const probe = await runProbe(item.ip, hostName);
        item.probeKbps = probe ? probe.kbps : null;
        if (!probe || !probe.ok) {
            item.score += 600;
            continue;
        }
        if (item.probeKbps < MIN_PROBE_KBPS) {
            item.score += 400;
        } else {
            item.score -= Math.min(220, Math.round(item.probeKbps / 20));
        }
    }

    base.sort((left, right) => left.score - right.score);
    return base;
}

function average(values) {
    if (!values.length) return 9999;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function aggregateMultiDomainResults(domainReports, candidates) {
    const merged = [];
    for (const candidateIp of candidates) {
        let delaySum = 0;
        let jitterSum = 0;
        let successSum = 0;
        let scoreSum = 0;
        let probeSum = 0;
        let probeCount = 0;
        let count = 0;

        for (const report of domainReports) {
            const row = report.resultMap.get(candidateIp) || {
                ip: candidateIp,
                delay: 9999,
                jitter: 9999,
                successRate: 0,
                score: 9999,
                probeKbps: null
            };
            delaySum += row.delay;
            jitterSum += row.jitter;
            successSum += row.successRate;
            scoreSum += row.score;
            count += 1;
            if (row.probeKbps !== null && row.probeKbps > 0) {
                probeSum += row.probeKbps;
                probeCount += 1;
            }
        }

        merged.push({
            ip: candidateIp,
            delay: Math.round(delaySum / count),
            jitter: Math.round(jitterSum / count),
            successRate: Number((successSum / count).toFixed(2)),
            score: Math.round(scoreSum / count),
            probeKbps: probeCount ? Math.round(probeSum / probeCount) : null
        });
    }

    merged.sort((left, right) => left.score - right.score);
    const dnsDelays = domainReports.map(report => report.dnsBest.delay).filter(delay => typeof delay === "number" && delay < 9999);
    return {
        results: merged,
        dnsBaselineDelay: average(dnsDelays)
    };
}

function shouldSendNotification(fingerprint) {
    const lowNoise = LOW_NOISE_MODE === "on" || LOW_NOISE_MODE === "true" || LOW_NOISE_MODE === "1";
    const now = Date.now();
    const lastTs = Number.parseInt($persistentStore.read(NOTIFY_TS_KEY) || "0", 10) || 0;
    const lastFingerprint = $persistentStore.read(NOTIFY_FP_KEY) || "";
    const cooldownMs = NOTIFY_COOLDOWN_MINUTES * 60 * 1000;

    if (lowNoise && lastFingerprint === fingerprint && now - lastTs < cooldownMs) {
        return false;
    }

    $persistentStore.write(String(now), NOTIFY_TS_KEY);
    $persistentStore.write(fingerprint, NOTIFY_FP_KEY);
    return true;
}

async function syncToGist(ipAddress, domains) {
    if (!GITHUB_TOKEN || !GIST_ID) {
        console.log("ℹ️ 未配置 GitHub Token 或 Gist ID，已跳过远端写入，仅保留本地结果。");
        return false;
    }

    const apiBase = "https://api.github.com/gists";
    const headers = {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Loon"
    };
    const withProxy = USE_IN_PROXY === "on" || USE_IN_PROXY === "true" || USE_IN_PROXY === "1";
    const hostLines = domains.map(domainName => withProxy ? `${domainName} = ${ipAddress}, use-in-proxy=true` : `${domainName} = ${ipAddress}`);
    const hostBody = hostLines.length
        ? `[Host]\n# 更新时间: ${new Date().toLocaleString()}\n` + hostLines.join("\n")
        : `[Host]\n# 更新时间: ${new Date().toLocaleString()}\n# 当前没有可写入的有效目标域名`;
    const pluginHeader = [
        "#!name=CF Seeded HostMap Sync",
        "#!desc=由 CF Seeded Optimizer 自动生成，请勿手动编辑。",
        "#!author=@Lee",
        "#!loon_version=3.2.1",
        `#!icon=${GENERATED_ICON}`
    ].join("\n");

    const payload = { files: { [GIST_FILENAME]: { content: OUTPUT_MODE === "host" ? hostBody : `${pluginHeader}\n\n${hostBody}` } } };

    try {
        await new Promise((resolve, reject) => {
            $httpClient.patch({ url: `${apiBase}/${GIST_ID}`, headers, body: JSON.stringify(payload) }, (err, resp) => {
                if (err || !resp || resp.status < 200 || resp.status >= 300) {
                    reject(new Error(`status=${resp ? resp.status : "n/a"}`));
                    return;
                }
                resolve();
            });
        });

        await new Promise((resolve, reject) => {
            $httpClient.get({ url: `${apiBase}/${GIST_ID}`, headers, timeout: 4000, node: "DIRECT" }, (err, resp, data) => {
                if (err || !resp || resp.status !== 200 || !data) {
                    reject(new Error("verify-failed"));
                    return;
                }
                try {
                    const json = JSON.parse(data);
                    const files = json.files || {};
                    const current = files[GIST_FILENAME] && typeof files[GIST_FILENAME].content === "string"
                        ? files[GIST_FILENAME].content
                        : "";
                    const mustContain = domains.length > 0 ? `${domains[0]} = ${ipAddress}` : "[Host]";
                    if (!current.includes(mustContain)) {
                        reject(new Error("verify-mismatch"));
                        return;
                    }
                    resolve();
                } catch (error) {
                    reject(new Error("verify-parse-error"));
                }
            });
        });

        return true;
    } catch (error) {
        console.log(`❌ Gist 更新失败: ${error.message}`);
        return false;
    }
}

async function collectSeedPool(seedDomains) {
    const reports = await Promise.all(seedDomains.map(async domainName => {
        const ips = await fetchDnsResolvedIPs(domainName);
        const cloudflareIps = ips.filter(isCloudflareIPv4);
        return {
            domainName,
            ips,
            cloudflareIps,
            valid: cloudflareIps.length > 0
        };
    }));

    return {
        validSeeds: reports.filter(item => item.valid).map(item => item.domainName),
        invalidSeeds: reports.filter(item => !item.valid).map(item => item.domainName),
        ips: uniqueIPv4List(reports.flatMap(item => item.cloudflareIps)).slice(0, SEED_POOL_LIMIT),
        updatedAt: Date.now()
    };
}

async function loadSeedPool(seedDomains) {
    const cached = readCacheJson(SEED_CACHE_KEY);
    const staleAfterMs = SEED_REFRESH_MINUTES * 60 * 1000;
    const cachedFingerprint = cached && Array.isArray(cached.seedDomains) ? cached.seedDomains.join("|") : "";
    const currentFingerprint = seedDomains.join("|");
    const cachedAge = cached && cached.updatedAt ? Date.now() - cached.updatedAt : Number.MAX_SAFE_INTEGER;

    if (cached && cachedFingerprint === currentFingerprint && cachedAge < staleAfterMs && Array.isArray(cached.ips) && cached.ips.length > 0) {
        return cached;
    }

    const remotePool = await fetchRemoteSeedPool(SEED_POOL_URL);
    if (remotePool && Array.isArray(remotePool.ips) && remotePool.ips.length > 0) {
        const remoteFingerprint = Array.isArray(remotePool.seedDomains) ? remotePool.seedDomains.join("|") : "";
        if (currentFingerprint && remoteFingerprint && remoteFingerprint !== currentFingerprint) {
            console.log("ℹ️ 远端种子池与本地种子域名列表不完全一致，仍优先使用远端候选池。");
        }

        const payload = {
            ...remotePool,
            seedDomains: remotePool.seedDomains.length ? remotePool.seedDomains : seedDomains,
            source: "remote-json"
        };
        $persistentStore.write(JSON.stringify(payload), SEED_CACHE_KEY);
        $persistentStore.write(String(payload.updatedAt || Date.now()), SEED_CACHE_TS_KEY);
        return payload;
    }

    if (cached && Array.isArray(cached.ips) && cached.ips.length > 0) {
        console.log("ℹ️ 远端种子池暂不可用，已回退到本地缓存。");
        return cached;
    }

    const refreshed = seedDomains.length > 0 ? await collectSeedPool(seedDomains) : { validSeeds: [], invalidSeeds: [], ips: [], updatedAt: Date.now(), seedDomains: [] };
    const payload = {
        ...refreshed,
        seedDomains,
        source: "auto-refresh"
    };
    $persistentStore.write(JSON.stringify(payload), SEED_CACHE_KEY);
    $persistentStore.write(String(payload.updatedAt), SEED_CACHE_TS_KEY);
    return payload;
}

async function main() {
    const pauseUntil = Number.parseInt($persistentStore.read(SWITCH_PAUSE_UNTIL_KEY) || "0", 10) || 0;
    if (Date.now() < pauseUntil) {
        const leftMinutes = Math.ceil((pauseUntil - Date.now()) / 60000);
        console.log(`⏸️ 处于退避窗口，剩余约 ${leftMinutes} 分钟，跳过切换。`);
        $done();
        return;
    }

    const seedDomains = parseDomainList(SEED_DOMAINS_RAW);
    const targetDomains = parseDomainList(TARGET_DOMAINS_RAW);
    if (targetDomains.length === 0) {
        console.log("⚠️ CF_TARGET_DOMAINS 不能为空。");
        $done();
        return;
    }

    const seedPool = seedDomains.length > 0 ? await loadSeedPool(seedDomains) : { ips: [], validSeeds: [], invalidSeeds: [], updatedAt: 0, seedDomains: [] };
    const currentIP = $persistentStore.read(CURRENT_IP_KEY) || "";

    const targetReports = await Promise.all(targetDomains.map(async domainName => {
        const ips = await fetchDnsResolvedIPs(domainName);
        const cloudflareIps = ips.filter(isCloudflareIPv4);
        return {
            domainName,
            ips,
            cloudflareIps,
            valid: cloudflareIps.length > 0
        };
    }));

    const activeTargets = targetReports.filter(item => item.valid).map(item => item.domainName);
    const skippedTargets = targetReports.filter(item => !item.valid).map(item => item.domainName);
    const targetDnsMap = new Map(targetReports.map(item => [item.domainName, item.cloudflareIps]));
    const targetPool = uniqueIPv4List(activeTargets.flatMap(domainName => targetDnsMap.get(domainName) || [])).slice(0, FALLBACK_TARGET_LIMIT);
    const candidatePool = uniqueIPv4List([
        ...(currentIP ? [currentIP] : []),
        ...seedPool.ips,
        ...targetPool
    ]).slice(0, CANDIDATE_LIMIT);

    console.log(`[运行信息] 目标域名: ${targetDomains.join(", ")}`);
    console.log(`[运行信息] 有效目标域名: ${activeTargets.join(", ") || "无"}`);
    console.log(`[运行信息] 种子域名: 有效 ${seedPool.validSeeds.length}/${seedDomains.length}，候选池 ${seedPool.ips.length}`);
    if (seedPool.validSeeds.length < MIN_VALID_SEED_DOMAINS) {
        console.log(`⚠️ 有效种子域名少于阈值(${seedPool.validSeeds.length}<${MIN_VALID_SEED_DOMAINS})，本轮将更多依赖目标域名兜底。`);
    }
    if (skippedTargets.length > 0) {
        console.log(`⚠️ 已跳过疑似非CF目标域名: ${skippedTargets.join(", ")}`);
    }
    if (seedPool.invalidSeeds && seedPool.invalidSeeds.length > 0) {
        console.log(`⚠️ 已跳过非CF种子域名: ${seedPool.invalidSeeds.join(", ")}`);
    }

    const domainFingerprint = activeTargets.join("|");
    const lastFingerprint = $persistentStore.read(LAST_TARGETS_KEY) || "";
    const domainSetChanged = domainFingerprint !== lastFingerprint;

    if (activeTargets.length === 0) {
        const cleared = await syncToGist("0.0.0.0", []);
        if (cleared) {
            $persistentStore.write("", LAST_TARGETS_KEY);
            console.log("ℹ️ 未检测到可用CF目标域名，已清理远端旧映射。");
        } else {
            console.log("❌ 未检测到可用CF目标域名，且清理远端旧映射失败。");
        }
        $done();
        return;
    }

    if (candidatePool.length === 0) {
        console.log("❌ 没有可用候选 IP，跳过本轮。");
        $done();
        return;
    }

    if (domainSetChanged) {
        console.log("ℹ️ 检测到目标域名列表变更，将在本轮同步后清理旧映射。");
    }

    const domainReports = await Promise.all(activeTargets.map(async domainName => {
        const rows = await evaluateCandidates(candidatePool, domainName);
        const resultMap = new Map(rows.map(row => [row.ip, row]));
        const dnsIps = targetDnsMap.get(domainName) || [];
        const dnsBest = rows
            .filter(row => dnsIps.includes(row.ip))
            .sort((left, right) => left.score - right.score)[0] || { ip: "-", delay: 9999, jitter: 9999, successRate: 0, score: 9999, probeKbps: null };
        return { domainName, resultMap, dnsBest };
    }));

    const merged = aggregateMultiDomainResults(domainReports, candidatePool);
    const results = merged.results;
    const best = results[0];

    const currentResult = currentIP
        ? (results.find(row => row.ip === currentIP) || { ip: currentIP, delay: 9999, jitter: 9999, successRate: 0, score: 9999, probeKbps: null })
        : { ip: "", delay: 9999, jitter: 9999, successRate: 0, score: 9999, probeKbps: null };

    const bestProbeText = best && best.probeKbps !== null ? `${best.probeKbps}KB/s` : "n/a";
    const domainDnsText = domainReports.map(report => `${report.domainName}:${report.dnsBest.ip}/${report.dnsBest.delay}ms`).join(" | ");
    const domainLabel = activeTargets.length === 1 ? activeTargets[0] : `${activeTargets[0]} 等${activeTargets.length}域`;

    console.log(`[候选] 缓存IP=${currentResult.ip || "无"}/${currentResult.delay}ms/j${currentResult.jitter}/s${currentResult.score} | DNS基线=${merged.dnsBaselineDelay}ms | 池最佳=${best.ip}/${best.delay}ms/p${bestProbeText}/s${best.score}`);
    console.log(`[DNS明细] ${domainDnsText}`);

    const now = Date.now();
    const lastSwitchAt = Number.parseInt($persistentStore.read(LAST_SWITCH_AT_KEY) || "0", 10) || 0;
    const intervalMet = now - lastSwitchAt >= MIN_SWITCH_MINUTES * 60 * 1000;
    const currentHealthy = currentIP && currentResult.delay <= STICKY_MS;
    const currentUnhealthy = !currentIP || currentResult.delay >= 9999 || currentResult.delay > STICKY_MS;
    const betterBy = currentResult.delay - best.delay;
    const scoreBetterBy = currentResult.score - best.score;
    const healthyCandidate = best.delay < 9999;
    const requireBeatDns = REQUIRE_BEAT_DNS === "on" || REQUIRE_BEAT_DNS === "true" || REQUIRE_BEAT_DNS === "1";
    const beatsDnsEnough = merged.dnsBaselineDelay < 9999 ? (best.delay + DNS_MARGIN_MS < merged.dnsBaselineDelay) : true;
    const probeEnabled = Boolean(normalizeProbePath(PROBE_PATH));
    const probeHealthy = !probeEnabled || (best.probeKbps !== null && best.probeKbps >= MIN_PROBE_KBPS);

    let shouldSwitch = false;
    let reason = "";
    let badRound = false;

    if (!healthyCandidate) {
        reason = "最佳候选不可用";
        badRound = true;
    } else if (!probeHealthy) {
        reason = `业务探针速率不足(${best.probeKbps || 0}KB/s < ${MIN_PROBE_KBPS}KB/s)`;
        badRound = true;
    } else if (best.delay > MAX_ACCEPT_DELAY) {
        reason = `候选延迟过高(${best.delay}ms>${MAX_ACCEPT_DELAY}ms)，不固化映射`;
        badRound = true;
    } else if (!currentIP) {
        if (requireBeatDns && !beatsDnsEnough) {
            reason = `首次运行且未显著优于DNS(阈值 ${DNS_MARGIN_MS}ms)，保持DNS动态调度`;
        } else {
            shouldSwitch = true;
            reason = "首次写入映射";
        }
    } else if (best.ip === currentIP) {
        reason = "最佳候选与当前映射一致";
    } else if (currentUnhealthy && betterBy > 0) {
        shouldSwitch = true;
        reason = "当前映射不健康，优先恢复到更优可用IP";
    } else if (requireBeatDns && !beatsDnsEnough) {
        reason = `未显著优于DNS(阈值 ${DNS_MARGIN_MS}ms)，不固化映射`;
    } else if (currentHealthy && !intervalMet) {
        reason = `未达到最小切换间隔(${MIN_SWITCH_MINUTES}分钟)`;
    } else if (intervalMet && betterBy >= MIN_IMPROVEMENT && scoreBetterBy >= Math.round(MIN_IMPROVEMENT * 0.6)) {
        shouldSwitch = true;
        reason = `满足切换阈值(延迟提升 ${betterBy}ms, 评分提升 ${scoreBetterBy})`;
    } else {
        reason = `提升不足阈值(延迟提升 ${betterBy}ms, 评分提升 ${scoreBetterBy})`;
    }

    if (shouldSwitch) {
        const synced = await syncToGist(best.ip, activeTargets);
        if (synced) {
            $persistentStore.write("0", BAD_ROUND_COUNT_KEY);
            $persistentStore.write("0", SWITCH_PAUSE_UNTIL_KEY);
            $persistentStore.write(best.ip, CURRENT_IP_KEY);
            $persistentStore.write(domainFingerprint, LAST_TARGETS_KEY);
            $persistentStore.write(String(now), LAST_SWITCH_AT_KEY);
            $persistentStore.write(String(now), LAST_GIST_SYNC_AT_KEY);

            if (AUTO_REFRESH_SUB === "on" || AUTO_REFRESH_SUB === "true" || AUTO_REFRESH_SUB === "1") {
                const fingerprint = `${domainLabel}|${best.ip}|${OUTPUT_MODE}`;
                if (shouldSendNotification(fingerprint)) {
                    $notification.post(
                        "CF Seeded 优选已更新",
                        "点击后刷新订阅以应用 Host 替换",
                        `${domainLabel} -> ${best.ip} (${best.delay}ms), 原IP ${currentResult.delay}ms, 模式 ${OUTPUT_MODE}`,
                        { openUrl: "loon://update?sub=all" }
                    );
                }
            }

            console.log(`✅ 调度完成: ${reason}`);
        }
    } else {
        if (badRound) {
            const badCount = (Number.parseInt($persistentStore.read(BAD_ROUND_COUNT_KEY) || "0", 10) || 0) + 1;
            $persistentStore.write(String(badCount), BAD_ROUND_COUNT_KEY);
            if (badCount >= 3) {
                const until = Date.now() + BAD_RUN_PAUSE_MINUTES * 60 * 1000;
                $persistentStore.write(String(until), SWITCH_PAUSE_UNTIL_KEY);
                $persistentStore.write("0", BAD_ROUND_COUNT_KEY);
                console.log(`⏸️ 连续劣化 ${badCount} 轮，进入退避 ${BAD_RUN_PAUSE_MINUTES} 分钟。`);
            }
        } else {
            $persistentStore.write("0", BAD_ROUND_COUNT_KEY);
        }

        if (domainSetChanged) {
            const fallbackIp = currentIP || (best && best.delay < 9999 ? best.ip : "");
            if (fallbackIp) {
                const cleaned = await syncToGist(fallbackIp, activeTargets);
                if (cleaned) {
                    $persistentStore.write(domainFingerprint, LAST_TARGETS_KEY);
                    console.log(`🧹 目标域名列表变更已同步，旧映射已清理，当前映射IP=${fallbackIp}`);
                } else {
                    console.log("⚠️ 目标域名列表变更同步失败，旧映射可能暂未清理。");
                }
            } else {
                console.log("⚠️ 目标域名列表已变更，但当前无可用IP用于同步清理。");
            }
        }

        console.log(`ℹ️ 本轮不切换: ${reason}`);
    }

    $done();
}

main();
