#!/usr/bin/env python3
"""Harvest Cloudflare seed IPs from a list of seed domains.

This script is designed for GitHub Actions or any server-side scheduler.
It resolves A records for each seed domain, filters Cloudflare IPv4 ranges,
then emits a compact JSON payload for downstream consumers.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import socket
import sys
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable, List

CF_IPV4_CIDRS = [
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
]


@dataclass(frozen=True)
class HarvestResult:
    seed_domains: List[str]
    valid_seed_domains: List[str]
    invalid_seed_domains: List[str]
    ips: List[str]
    updated_at: int
    source: str = "github-actions"


def parse_domains(raw_value: str, limit: int) -> List[str]:
    items: List[str] = []
    for token in raw_value.replace("\n", ",").split(","):
        value = token.strip().lower()
        if not value:
            continue
        if value not in items:
            items.append(value)
        if len(items) >= limit:
            break
    return items


def load_cf_networks() -> List[ipaddress.IPv4Network]:
    return [ipaddress.ip_network(cidr) for cidr in CF_IPV4_CIDRS]


def is_cloudflare_ipv4(ip_value: str, networks: Iterable[ipaddress.IPv4Network]) -> bool:
    try:
        ip_obj = ipaddress.ip_address(ip_value)
    except ValueError:
        return False
    if ip_obj.version != 4:
        return False
    return any(ip_obj in network for network in networks)


def resolve_ipv4s(domain: str) -> List[str]:
    ips = []
    try:
        infos = socket.getaddrinfo(domain, None, family=socket.AF_INET, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return []

    for entry in infos:
        sockaddr = entry[4]
        if not sockaddr:
            continue
        ip_value = sockaddr[0]
        if ip_value not in ips:
            ips.append(ip_value)
    return ips


def unique(items: Iterable[str]) -> List[str]:
    seen = set()
    result = []
    for item in items:
        if item in seen:
            continue
        seen.add(item)
        result.append(item)
    return result


def harvest(seed_domains: List[str], max_ips: int) -> HarvestResult:
    networks = load_cf_networks()
    valid_domains = []
    invalid_domains = []
    pool = []

    for domain in seed_domains:
        resolved = resolve_ipv4s(domain)
        cf_ips = [ip for ip in resolved if is_cloudflare_ipv4(ip, networks)]
        if cf_ips:
            valid_domains.append(domain)
            pool.extend(cf_ips)
        else:
            invalid_domains.append(domain)

    return HarvestResult(
        seed_domains=seed_domains,
        valid_seed_domains=valid_domains,
        invalid_seed_domains=invalid_domains,
        ips=unique(pool)[:max_ips],
        updated_at=int(time.time()),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Harvest Cloudflare seed IPs from seed domains.")
    parser.add_argument("--seed-domains", default=os.environ.get("CF_SEED_DOMAINS", ""), help="Comma/newline separated seed domains")
    parser.add_argument("--max-seed-domains", type=int, default=int(os.environ.get("CF_MAX_SEED_DOMAINS", "12")), help="Maximum seed domains to process")
    parser.add_argument("--seed-pool-limit", type=int, default=int(os.environ.get("CF_SEED_POOL_LIMIT", "80")), help="Maximum number of seed IPs")
    parser.add_argument("--output", default=os.environ.get("CF_OUTPUT_FILE", "data/seed_pool.json"), help="Output JSON file")
    args = parser.parse_args()

    seed_domains = parse_domains(args.seed_domains, args.max_seed_domains)
    if not seed_domains:
        print("CF_SEED_DOMAINS is empty", file=sys.stderr)
        return 1

    result = harvest(seed_domains, args.seed_pool_limit)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(asdict(result), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"updated_at={result.updated_at}")
    print(f"seed_domains={len(result.seed_domains)} valid={len(result.valid_seed_domains)} invalid={len(result.invalid_seed_domains)} ips={len(result.ips)}")
    if result.invalid_seed_domains:
        print("invalid=" + ",".join(result.invalid_seed_domains))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
