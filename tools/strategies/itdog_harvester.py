#!/usr/bin/env python3
"""ITDog-based Cloudflare IP harvester strategy.

Scrapes CF IP information from ITDog (一个IP) web portal.
Suitable for local enrichment when DNS resolution is insufficient,
or as a periodic supplement to DNS-harvested pools.

Note: Requires 'requests' library. Install via: pip install requests
"""

from __future__ import annotations

import json
import re
import socket
import time
from typing import List, Optional
from urllib.parse import quote

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

from .base import BaseHarvester, StrategyResult


class ITDogHarvester(BaseHarvester):
    """Harvest CF IPs from ITDog portal API and web scraping."""

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

    # ITDog API endpoints that return CF IP lists
    ITDOG_API_BASE = "https://www.itdog.cn"
    ITDOG_API_ENDPOINT = "/api/lookup"

    # Timeout for individual requests (seconds)
    REQUEST_TIMEOUT = 5

    def __init__(self, max_seed_domains: int = 12, max_ips: int = 80):
        super().__init__(max_seed_domains, max_ips)
        if not REQUESTS_AVAILABLE:
            raise ImportError("ITDog harvester requires 'requests' library. Install via: pip install requests")

    @property
    def name(self) -> str:
        return "itdog"

    def harvest(self, seed_domains: List[str]) -> StrategyResult:
        """Harvest CF IPs via ITDog portal lookup.
        
        For each seed domain, queries ITDog API to fetch associated CF IPs.
        Falls back to direct DNS resolution if API fails.
        """
        start_ms = int(time.time() * 1000)
        valid_domains = []
        invalid_domains = []
        cf_ips = []
        errors = []

        for domain in seed_domains[:self.max_seed_domains]:
            try:
                # First attempt: ITDog API query
                api_ips = self._query_itdog_api(domain)
                
                # Fallback: Direct DNS resolution if API returns nothing
                if not api_ips:
                    api_ips = self._resolve_domain_direct(domain)
                
                filtered_ips = self.filter_cloudflare_ips(api_ips, self.CF_IPV4_CIDRS)
                
                if filtered_ips:
                    valid_domains.append(domain)
                    cf_ips.extend(filtered_ips)
                else:
                    invalid_domains.append(domain)
            except Exception as e:
                invalid_domains.append(domain)
                errors.append(f"{domain}: {str(e)}")

        unique_ips = self.deduplicate(cf_ips)[:self.max_ips]
        elapsed = int(time.time() * 1000) - start_ms

        error_msg = "; ".join(errors) if errors else ""

        return StrategyResult(
            strategy_name=self.name,
            seed_domains=seed_domains[:self.max_seed_domains],
            valid_domains=valid_domains,
            invalid_domains=invalid_domains,
            ips=unique_ips,
            elapsed_ms=elapsed,
            error=error_msg,
        )

    def _query_itdog_api(self, domain: str) -> List[str]:
        """Query ITDog API for IP records of a domain.
        
        Args:
            domain: Domain name to query
            
        Returns:
            List of IP addresses found
        """
        ips = []
        try:
            # Method 1: Try ITDog native API
            # ITDog returns structured data about domain IPs
            url = f"{self.ITDOG_API_BASE}{self.ITDOG_API_ENDPOINT}?domain={quote(domain)}"
            
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json, text/plain, */*",
            }
            
            response = requests.get(url, headers=headers, timeout=self.REQUEST_TIMEOUT)
            if response.status_code == 200:
                data = response.json()
                
                # Parse ITDog API response format
                if isinstance(data, dict):
                    # Try multiple common response structures
                    if "data" in data and isinstance(data["data"], list):
                        for item in data["data"]:
                            if isinstance(item, dict):
                                if "ip" in item:
                                    ips.append(item["ip"])
                                elif "address" in item:
                                    ips.append(item["address"])
                    elif "ip" in data:
                        ips.append(data["ip"])
                    elif "ips" in data and isinstance(data["ips"], list):
                        ips.extend(data["ips"])
                        
        except Exception as e:
            # Silently fail for API call; fallback to DNS below
            pass

        return ips

    @staticmethod
    def _resolve_domain_direct(domain: str) -> List[str]:
        """Direct DNS resolution as fallback.
        
        Args:
            domain: Domain to resolve
            
        Returns:
            List of IPv4 addresses
        """
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
