// CF Seed Harvest
// 作用：解析一组稳定的 CF 种子域名，提取可用的 Cloudflare IPv4 候选池，并缓存到 Loon 持久化存储。

const ARG = (typeof $argument === "object" && $argument !== null) ? $argument : {};
const isPlaceholder = (value) => typeof value === "string" && /^\{.+\}$/.test(value.trim());

const SEED_DOMAINS_RAW = (ARG.CF_SEED_DOMAINS || "").trim();
const SEED_POOL_LIMIT = Math.min(200, Math.max(10, Number.parseInt((ARG.CF_SEED_POOL_LIMIT || "80").trim(), 10) || 80));
const MAX_SEED_DOMAINS = Math.min(24, Math.max(1, Number.parseInt((ARG.CF_MAX_SEED_DOMAINS || "12").trim(), 10) || 12));
const CACHE_KEY = "CF_SEEDED_OPT_SEED_POOL_CACHE";
const CACHE_TS_KEY = "CF_SEEDED_OPT_SEED_POOL_UPDATED_AT";

if (typeof $argument === "undefined" || isPlaceholder(SEED_DOMAINS_RAW)) {
    console.log("⚠️ 种子域名参数尚未生效：请在插件参数页填写真实值后再执行。");
    $done();
    return;
}

function parseDomainList(rawValue) {
    return Array.from(new Set(
        rawValue
            .split(/[\r\n,]+/)
            .map(item => item.trim().toLowerCase())
            .filter(Boolean)
    )).slice(0, MAX_SEED_DOMAINS);
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

async function main() {
    const seedDomains = parseDomainList(SEED_DOMAINS_RAW);
    if (seedDomains.length === 0) {
        console.log("⚠️ CF_SEED_DOMAINS 不能为空。");
        $done();
        return;
    }

    const results = await Promise.all(seedDomains.map(async domainName => {
        const ips = await fetchDnsResolvedIPs(domainName);
        const cloudflareIps = ips.filter(isCloudflareIPv4);
        return {
            domainName,
            ips,
            cloudflareIps,
            valid: cloudflareIps.length > 0
        };
    }));

    const validSeeds = results.filter(item => item.valid).map(item => item.domainName);
    const invalidSeeds = results.filter(item => !item.valid).map(item => item.domainName);
    const pool = uniqueIPv4List(results.flatMap(item => item.cloudflareIps)).slice(0, SEED_POOL_LIMIT);

    const payload = {
        updatedAt: Date.now(),
        seedDomains,
        validSeeds,
        invalidSeeds,
        ips: pool
    };

    $persistentStore.write(JSON.stringify(payload), CACHE_KEY);
    $persistentStore.write(String(payload.updatedAt), CACHE_TS_KEY);

    console.log(`[种子采集] 总数=${seedDomains.length} | 有效=${validSeeds.length} | 无效=${invalidSeeds.length} | 候选IP=${pool.length}`);
    if (invalidSeeds.length > 0) {
        console.log(`[种子采集] 已跳过非CF种子域名: ${invalidSeeds.join(", ")}`);
    }
    if (pool.length > 0) {
        console.log(`[种子采集] 预览: ${pool.slice(0, 6).join(", ")}${pool.length > 6 ? " ..." : ""}`);
    } else {
        console.log("⚠️ 本轮没有采集到可用 CF 候选 IP。");
    }

    $done();
}

main();
