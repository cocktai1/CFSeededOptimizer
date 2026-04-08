#!/usr/bin/env python3
"""Public repository based Cloudflare IP harvester.

Fetches plain text IP lists from public repositories (for example bestcf.txt),
extracts IPv4 addresses, filters them by Cloudflare CIDR ranges, then returns
deduplicated candidates for seed_pool merging.
"""

from __future__ import annotations

import re
import time
import urllib.request
from typing import List

from .base import BaseHarvester, StrategyResult


class PublicRepoHarvester(BaseHarvester):
    """Harvest CF IPs from public text repositories."""

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

    IPV4_PATTERN = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")

    def __init__(self, max_seed_domains: int = 12, max_ips: int = 80, source_urls: List[str] | None = None, timeout_sec: int = 6):
        super().__init__(max_seed_domains, max_ips)
        self.source_urls = source_urls or []
        self.timeout_sec = max(2, timeout_sec)

    @property
    def name(self) -> str:
        return "public_repo"

    def harvest(self, seed_domains: List[str]) -> StrategyResult:
        start_ms = int(time.time() * 1000)
        if not self.source_urls:
            return StrategyResult(
                strategy_name=self.name,
                seed_domains=seed_domains[: self.max_seed_domains],
                valid_domains=[],
                invalid_domains=[],
                ips=[],
                elapsed_ms=0,
                error="public repo urls empty",
            )

        merged_ips: List[str] = []
        failed_urls: List[str] = []

        for url in self.source_urls:
            ips = self._fetch_ip_list(url)
            if not ips:
                failed_urls.append(url)
            merged_ips.extend(ips)

        cf_ips = self.filter_cloudflare_ips(self.deduplicate(merged_ips), self.CF_IPV4_CIDRS)
        unique_ips = self.deduplicate(cf_ips)[: self.max_ips]
        elapsed = int(time.time() * 1000) - start_ms

        error_msg = ""
        if failed_urls:
            error_msg = f"failed_sources={len(failed_urls)}"

        return StrategyResult(
            strategy_name=self.name,
            seed_domains=seed_domains[: self.max_seed_domains],
            valid_domains=[],
            invalid_domains=[],
            ips=unique_ips,
            elapsed_ms=elapsed,
            error=error_msg,
        )

    def _fetch_ip_list(self, url: str) -> List[str]:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "CFSeededOptimizer/1.0"})
            with urllib.request.urlopen(request, timeout=self.timeout_sec) as response:
                body = response.read().decode("utf-8", errors="ignore")
        except Exception:
            return []

        ips: List[str] = []
        for match in self.IPV4_PATTERN.findall(body):
            parts = match.split(".")
            if any(int(part) < 0 or int(part) > 255 for part in parts):
                continue
            ips.append(match)
        return self.deduplicate(ips)
