#!/usr/bin/env python3
"""Harvest Cloudflare seed IPs using pluggable strategies.

Supports multiple harvesting strategies:
- 'dns': DNS resolution via socket API (default, stable, server-side)
- 'itdog': Scraping from ITDog portal (supplementary, local-side)

This script is designed for GitHub Actions or any scheduler.
It outputs a compact JSON payload for downstream consumers.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import List

from strategies import DNSHarvester, ITDogHarvester, LocationAwareITDogHarvester, StrategyResult

DEFAULT_SEED_DOMAIN_GROUPS = {
    "tier1": [
        "time.cloudflare.com",
        "speed.cloudflare.com",
        "cdnjs.cloudflare.com",
    ],
    "tier2": [
        "www.cloudflare.com",
        "developers.cloudflare.com",
        "workers.cloudflare.com",
        "one.one.one.one",
    ],
    "tier3": [
        "shopee.sg",
        "shopee.tw",
        "icook.tw",
        "www.digitalocean.com",
        "cloudflare.steamstatic.com",
    ],
}

DEFAULT_SEED_DOMAINS = [
    *DEFAULT_SEED_DOMAIN_GROUPS["tier1"],
    *DEFAULT_SEED_DOMAIN_GROUPS["tier2"],
    *DEFAULT_SEED_DOMAIN_GROUPS["tier3"],
]

# Strategy registry: maps strategy name to harvester class
STRATEGY_REGISTRY = {
    "dns": DNSHarvester,
    "itdog": ITDogHarvester,
    "itdog_location": LocationAwareITDogHarvester,
}


@dataclass(frozen=True)
class HarvestResult:
    seed_domains: List[str]
    valid_seed_domains: List[str]
    invalid_seed_domains: List[str]
    ips: List[str]
    updated_at: int
    source: str = "github-actions"
    strategies: List[str] = field(default_factory=list)  # Added: track which strategies were used
    extended: dict = field(default_factory=dict)  # Added: extensibility for future metadata


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


def merge_results(results: List[StrategyResult]) -> HarvestResult:
    """Merge results from multiple harvesting strategies.
    
    Combines IPs from all strategies, deduplicates, and tracks
    which strategies contributed IPs.
    """
    all_domains = []
    all_valid = []
    all_invalid = []
    all_ips = []
    strategy_names = []

    # Collect seed domains (from first strategy with valid count)
    for result in results:
        if result.seed_domains:
            all_domains = result.seed_domains
            break

    # Merge valid/invalid domains and IPs
    seen_domains = set()
    for result in results:
        strategy_names.append(result.strategy_name)
        
        for domain in result.valid_domains:
            if domain not in seen_domains:
                all_valid.append(domain)
                seen_domains.add(domain)
        
        for domain in result.invalid_domains:
            if domain not in seen_domains:
                all_invalid.append(domain)
                seen_domains.add(domain)
        
        all_ips.extend(result.ips)

    # Deduplicate IPs
    seen_ips = set()
    unique_ips = []
    for ip in all_ips:
        if ip not in seen_ips:
            unique_ips.append(ip)
            seen_ips.add(ip)

    # Build extended metadata
    extended = {
        "strategies": strategy_names,
        "strategy_count": len(results),
        "strategy_details": [
            {
                "name": r.strategy_name,
                "ips": len(r.ips),
                "elapsed_ms": r.elapsed_ms,
                "error": r.error if r.error else None,
            }
            for r in results
        ],
    }

    return HarvestResult(
        seed_domains=all_domains,
        valid_seed_domains=all_valid,
        invalid_seed_domains=all_invalid,
        ips=unique_ips,
        updated_at=int(time.time()),
        strategies=strategy_names,
        extended=extended,
    )


def get_harvester_class(strategy_name: str):
    """Get harvester class by name."""
    if strategy_name not in STRATEGY_REGISTRY:
        raise ValueError(f"Unknown strategy: {strategy_name}. Available: {', '.join(STRATEGY_REGISTRY.keys())}")
    return STRATEGY_REGISTRY[strategy_name]


def main() -> int:
    parser = argparse.ArgumentParser(description="Harvest Cloudflare seed IPs using pluggable strategies.")
    parser.add_argument(
        "--seed-domains",
        default=os.environ.get("CF_SEED_DOMAINS", ",".join(DEFAULT_SEED_DOMAINS)),
        help="Comma/newline separated seed domains",
    )
    parser.add_argument(
        "--max-seed-domains",
        type=int,
        default=int(os.environ.get("CF_MAX_SEED_DOMAINS", "12")),
        help="Maximum seed domains to process",
    )
    parser.add_argument(
        "--seed-pool-limit",
        type=int,
        default=int(os.environ.get("CF_SEED_POOL_LIMIT", "80")),
        help="Maximum number of seed IPs",
    )
    parser.add_argument(
        "--strategies",
        default=os.environ.get("CF_HARVEST_STRATEGIES", "dns"),
        help="Comma-separated strategy names (dns, itdog, itdog_location). Default: dns",
    )
    parser.add_argument(
        "--city",
        default=os.environ.get("CF_HARVEST_CITY", "成都"),
        help="Target city for location-aware harvesting (成都/北京/上海/广州/深圳/杭州/南京/武汉/西安/重庆/苏州/天津). Default: 成都",
    )
    parser.add_argument(
        "--isp",
        default=os.environ.get("CF_HARVEST_ISP", "电信"),
        help="Target ISP type (电信/联通/移动/铁通/教育网). Default: 电信",
    )
    parser.add_argument(
        "--speed-preference",
        default=os.environ.get("CF_HARVEST_SPEED_PREFERENCE", "balanced"),
        help="Speed preference (ultra_fast/fast/balanced/stable). Default: balanced",
    )
    parser.add_argument(
        "--network-type",
        default=os.environ.get("CF_HARVEST_NETWORK_TYPE", "fixed"),
        help="Network type (fixed/4g/5g). Default: fixed",
    )
    parser.add_argument(
        "--prefer-fresh",
        action="store_true",
        default=os.environ.get("CF_HARVEST_PREFER_FRESH", "true").lower() == "true",
        help="Prefer fresh IPs. Default: true",
    )
    parser.add_argument(
        "--output",
        default=os.environ.get("CF_OUTPUT_FILE", "data/seed_pool.json"),
        help="Output JSON file",
    )
    args = parser.parse_args()

    seed_domains = parse_domains(args.seed_domains, args.max_seed_domains)
    if not seed_domains:
        print("CF_SEED_DOMAINS is empty", file=sys.stderr)
        return 1

    # Parse strategy names
    strategy_names = [s.strip().lower() for s in args.strategies.split(",") if s.strip()]
    if not strategy_names:
        strategy_names = ["dns"]

    # Validate strategies
    for strategy_name in strategy_names:
        if strategy_name not in STRATEGY_REGISTRY:
            print(f"❌ Unknown strategy: {strategy_name}. Available: {', '.join(STRATEGY_REGISTRY.keys())}", file=sys.stderr)
            return 1

    # Execute strategies
    results = []
    for strategy_name in strategy_names:
        try:
            harvester_class = get_harvester_class(strategy_name)
            
            # Instantiate harvester with appropriate parameters
            if strategy_name == "itdog_location":
                harvester = harvester_class(
                    max_seed_domains=args.max_seed_domains,
                    max_ips=args.seed_pool_limit,
                    city=args.city,
                    isp=args.isp,
                    speed_preference=args.speed_preference,
                    network_type=args.network_type,
                    prefer_fresh=args.prefer_fresh,
                )
            else:
                harvester = harvester_class(max_seed_domains=args.max_seed_domains, max_ips=args.seed_pool_limit)
            
            result = harvester.harvest(seed_domains)
            results.append(result)
            
            # Enhanced output for location-aware strategy
            if strategy_name == "itdog_location":
                print(f"✓ {strategy_name} ({args.city}/{args.isp}): {len(result.ips)} IPs in {result.elapsed_ms}ms", file=sys.stderr)
            else:
                print(f"✓ {strategy_name}: {len(result.ips)} IPs in {result.elapsed_ms}ms", file=sys.stderr)
            
            if result.error:
                print(f"  ⚠️  {result.error}", file=sys.stderr)
        except Exception as e:
            print(f"❌ Strategy {strategy_name} failed: {e}", file=sys.stderr)
            return 1

    # Merge results from all strategies
    merged = merge_results(results)

    # Write output
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(asdict(merged), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    # Summary
    print(f"updated_at={merged.updated_at}")
    print(f"seed_domains={len(merged.seed_domains)} valid={len(merged.valid_seed_domains)} invalid={len(merged.invalid_seed_domains)} ips={len(merged.ips)}")
    if merged.invalid_seed_domains:
        print("invalid=" + ",".join(merged.invalid_seed_domains))
    if merged.strategies:
        print("strategies=" + ",".join(merged.strategies))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
