#!/usr/bin/env python3
"""DNS-based Cloudflare IP harvester strategy.

Resolves A records for seed domains via socket API and filters by CF CIDR ranges.
This is the stable, server-side strategy suitable for GitHub Actions execution.
"""

from __future__ import annotations

import socket
import time
from typing import List

from .base import BaseHarvester, StrategyResult


class DNSHarvester(BaseHarvester):
    """Harvest CF IPs by DNS resolution of seed domains."""

    # 15 official Cloudflare IPv4 CIDR ranges
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

    @property
    def name(self) -> str:
        return "dns"

    def harvest(self, seed_domains: List[str]) -> StrategyResult:
        """Harvest CF IPs via DNS resolution.
        
        Uses socket.getaddrinfo() for direct DNS resolution,
        then filters results by CF CIDR ranges.
        """
        start_ms = int(time.time() * 1000)
        valid_domains = []
        invalid_domains = []
        cf_ips = []

        for domain in seed_domains[:self.max_seed_domains]:
            resolved_ips = self._resolve_domain(domain)
            filtered_ips = self.filter_cloudflare_ips(resolved_ips, self.CF_IPV4_CIDRS)
            
            if filtered_ips:
                valid_domains.append(domain)
                cf_ips.extend(filtered_ips)
            else:
                invalid_domains.append(domain)

        unique_ips = self.deduplicate(cf_ips)[:self.max_ips]
        elapsed = int(time.time() * 1000) - start_ms

        return StrategyResult(
            strategy_name=self.name,
            seed_domains=seed_domains[:self.max_seed_domains],
            valid_domains=valid_domains,
            invalid_domains=invalid_domains,
            ips=unique_ips,
            elapsed_ms=elapsed,
        )

    @staticmethod
    def _resolve_domain(domain: str) -> List[str]:
        """Resolve domain to IPv4 addresses using socket API."""
        ips = []
        try:
            infos = socket.getaddrinfo(domain, None, family=socket.AF_INET, type=socket.SOCK_STREAM)
            for entry in infos:
                sockaddr = entry[4]
                if sockaddr:
                    ip_value = sockaddr[0]
                    if ip_value not in ips:
                        ips.append(ip_value)
        except socket.gaierror:
            pass
        return ips
