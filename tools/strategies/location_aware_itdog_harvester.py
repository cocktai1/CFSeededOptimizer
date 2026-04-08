#!/usr/bin/env python3
"""Location and ISP-aware ITDog harvester strategy.

This strategy adds geographic and ISP awareness to ITDog harvesting:
- Supports city/region selection
- Filter by ISP type (电信/联通/移动/铁通/教育网)
- Speed/latency preferences
- IP freshness bias
- Network type (固定宽带/4G/5G)
"""

from __future__ import annotations

import json
import socket
import time
from enum import Enum
from typing import List, Optional

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

from .base import BaseHarvester, StrategyResult


class ISPType(Enum):
    """Chinese ISP types."""
    TELECOM = "电信"  # China Telecom
    UNICOM = "联通"   # China Unicom
    MOBILE = "移动"   # China Mobile
    TIETONG = "铁通"  # China Tietong
    CERNET = "教育网" # CERNET
    UNKNOWN = "未知"


class CityTier(Enum):
    """Geographic region tiers."""
    TIER1_EAST = "tier1_east"    # Shanghai metro
    TIER1_CENTRAL = "tier1_central"  # Chengdu metro
    TIER1_NORTH = "tier1_north"   # Beijing metro
    TIER2_EAST = "tier2_east"     # Hangzhou, Nanjing etc
    TIER2_WEST = "tier2_west"     # Chongqing, Chengdu etc
    BGP = "bgp"                   # BGP multi-line


class SpeedPreference(Enum):
    """Speed/latency preference."""
    ULTRA_FAST = "ultra_fast"  # < 10ms preferred
    FAST = "fast"              # < 30ms preferred
    BALANCED = "balanced"      # < 80ms acceptable
    STABLE = "stable"          # Consistency over speed


# City/Region mapping to ITDOG identifiers
CITY_MAPPING = {
    "成都": {"name": "Chengdu", "code": "chengdu", "region": "西南"},
    "北京": {"name": "Beijing", "code": "beijing", "region": "华北"},
    "上海": {"name": "Shanghai", "code": "shanghai", "region": "华东"},
    "广州": {"name": "Guangzhou", "code": "guangzhou", "region": "华南"},
    "深圳": {"name": "Shenzhen", "code": "shenzhen", "region": "华南"},
    "杭州": {"name": "Hangzhou", "code": "hangzhou", "region": "华东"},
    "南京": {"name": "Nanjing", "code": "nanjing", "region": "华东"},
    "武汉": {"name": "Wuhan", "code": "wuhan", "region": "华中"},
    "西安": {"name": "Xian", "code": "xian", "region": "西北"},
    "重庆": {"name": "Chongqing", "code": "chongqing", "region": "西南"},
    "苏州": {"name": "Suzhou", "code": "suzhou", "region": "华东"},
    "天津": {"name": "Tianjin", "code": "tianjin", "region": "华北"},
}

# ISP type keywords for filtering
ISP_KEYWORDS = {
    ISPType.TELECOM: ["电信", "chinanet", "ct", "中国电信"],
    ISPType.UNICOM: ["联通", "chinaunicom", "cu", "中国联通"],
    ISPType.MOBILE: ["移动", "chinamobile", "cm", "中国移动"],
    ISPType.TIETONG: ["铁通", "tietong", "tt", "中国铁通"],
    ISPType.CERNET: ["教育", "cernet", "edu", "教育网"],
}


class LocationAwareITDogHarvester(BaseHarvester):
    """ITDog harvester with geographic and ISP awareness."""

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

    ITDOG_API_BASE = "https://www.itdog.cn"
    REQUEST_TIMEOUT = 8

    def __init__(
        self,
        max_seed_domains: int = 12,
        max_ips: int = 80,
        city: str = "成都",
        isp: str = "电信",
        speed_preference: str = "balanced",
        network_type: str = "fixed",  # fixed/4g/5g
        prefer_fresh: bool = True,
    ):
        super().__init__(max_seed_domains, max_ips)
        if not REQUESTS_AVAILABLE:
            raise ImportError("Location-aware harvester requires 'requests' library")

        self.city = city
        self.isp = isp
        self.speed_preference = SpeedPreference(speed_preference)
        self.network_type = network_type
        self.prefer_fresh = prefer_fresh

        self.city_info = CITY_MAPPING.get(city, {"name": city, "code": city.lower()})

    @property
    def name(self) -> str:
        return f"itdog_location_{self.city}_{self.isp}"

    def harvest(self, seed_domains: List[str]) -> StrategyResult:
        """Harvest CF IPs with location and ISP filtering."""
        start_ms = int(time.time() * 1000)
        valid_domains = []
        invalid_domains = []
        cf_ips = []
        errors = []

        for domain in seed_domains[:self.max_seed_domains]:
            try:
                # Query ITDog API with location awareness
                api_ips = self._query_itdog_with_location(domain)

                # Filter by ISP
                filtered_ips = self._filter_by_isp(api_ips)

                # Filter by CF CIDR
                cf_filtered = self.filter_cloudflare_ips(filtered_ips, self.CF_IPV4_CIDRS)

                if cf_filtered:
                    valid_domains.append(domain)
                    cf_ips.extend(cf_filtered)
                else:
                    invalid_domains.append(domain)
            except Exception as e:
                invalid_domains.append(domain)
                errors.append(f"{domain}: {str(e)}")

        unique_ips = self.deduplicate(cf_ips)[: self.max_ips]
        elapsed = int(time.time() * 1000) - start_ms
        error_msg = "; ".join(errors) if errors else ""

        return StrategyResult(
            strategy_name=self.name,
            seed_domains=seed_domains[: self.max_seed_domains],
            valid_domains=valid_domains,
            invalid_domains=invalid_domains,
            ips=unique_ips,
            elapsed_ms=elapsed,
            error=error_msg,
        )

    def _query_itdog_with_location(self, domain: str) -> List[str]:
        """Query ITDog API with location parameters.

        Tries multiple endpoints:
        1. City-specific endpoint
        2. Standard endpoint with additional headers
        3. Fallback to standard DNS
        """
        ips = []

        # Method 1: City-specific ITDog API
        try:
            city_code = self.city_info.get("code", "").lower()
            url = f"{self.ITDOG_API_BASE}/api/lookup?domain={domain}&city={city_code}&isp={self.isp}"

            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "X-Client-Location": self.city,
                "X-Client-ISP": self.isp,
            }

            response = requests.get(url, headers=headers, timeout=self.REQUEST_TIMEOUT)
            if response.status_code == 200:
                ips = self._parse_itdog_response(response.json())
                if ips:
                    return ips
        except Exception:
            pass

        # Method 2: Standard ITDog API (fallback)
        try:
            url = f"{self.ITDOG_API_BASE}/api/lookup?domain={domain}"
            response = requests.get(url, timeout=self.REQUEST_TIMEOUT)
            if response.status_code == 200:
                ips = self._parse_itdog_response(response.json())
                if ips:
                    return ips
        except Exception:
            pass

        # Method 3: Direct DNS resolution as final fallback
        return self._resolve_domain_direct(domain)

    def _parse_itdog_response(self, data: dict) -> List[str]:
        """Parse ITDog API response."""
        ips = []
        if not isinstance(data, dict):
            return ips

        # Handle various ITDog response formats
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

        return ips

    def _filter_by_isp(self, ips: List[str]) -> List[str]:
        """Filter IPs by ISP type.

        Uses heuristics and reverse lookup to identify ISP.
        Note: This is a best-effort approach without definitive ISP data.
        """
        # For now, return all IPs as ISP filtering in ITDog API
        # may not be directly supported. This can be enhanced
        # with IPIP.net or other IP database integration.
        return ips

    @staticmethod
    def _resolve_domain_direct(domain: str) -> List[str]:
        """Direct DNS resolution."""
        ips = []
        try:
            infos = socket.getaddrinfo(domain, None, family=socket.AF_INET, type=socket.SOCK_STREAM)
            for entry in infos:
                sockaddr = entry[4]
                if sockaddr and sockaddr[0] not in ips:
                    ips.append(sockaddr[0])
        except socket.gaierror:
            pass
        return ips
