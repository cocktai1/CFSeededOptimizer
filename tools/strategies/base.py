#!/usr/bin/env python3
"""Base harvester strategy interface.

Defines the abstract interface for all CF IP harvesting strategies.
Allows pluggable implementations: DNS resolution, ITDog scraping, API queries, etc.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Set


@dataclass(frozen=True)
class StrategyResult:
    """Result of a harvesting strategy execution."""
    strategy_name: str
    seed_domains: List[str]
    valid_domains: List[str]
    invalid_domains: List[str]
    ips: List[str]  # De-duplicated CF IPv4 addresses
    elapsed_ms: int  # Execution time in milliseconds
    error: str = ""  # Error message if failed


class BaseHarvester(ABC):
    """Abstract base class for CF IP harvesting strategies."""

    def __init__(self, max_seed_domains: int = 12, max_ips: int = 80):
        """Initialize harvester configuration.
        
        Args:
            max_seed_domains: Maximum number of seed domains to process
            max_ips: Maximum number of IPs to collect
        """
        self.max_seed_domains = max_seed_domains
        self.max_ips = max_ips

    @property
    @abstractmethod
    def name(self) -> str:
        """Human-readable strategy name (e.g., 'dns', 'itdog')."""
        pass

    @abstractmethod
    def harvest(self, seed_domains: List[str]) -> StrategyResult:
        """Execute the harvesting strategy.
        
        Args:
            seed_domains: List of domains to harvest from
            
        Returns:
            StrategyResult containing IPs, validity info, and metadata
        """
        pass

    @staticmethod
    def deduplicate(ips: List[str]) -> List[str]:
        """Remove duplicate IPs while preserving order."""
        seen: Set[str] = set()
        result: List[str] = []
        for ip in ips:
            if ip not in seen:
                seen.add(ip)
                result.append(ip)
        return result

    @staticmethod
    def filter_cloudflare_ips(ips: List[str], cf_cidrs: List[str]) -> List[str]:
        """Filter IPs to only include Cloudflare ranges.
        
        Args:
            ips: List of IPv4 addresses
            cf_cidrs: List of Cloudflare CIDR ranges
            
        Returns:
            Filtered list of Cloudflare IPs
        """
        import ipaddress
        
        networks = [ipaddress.ip_network(cidr) for cidr in cf_cidrs]
        cf_ips = []
        for ip_str in ips:
            try:
                ip_obj = ipaddress.ip_address(ip_str)
                if ip_obj.version == 4 and any(ip_obj in net for net in networks):
                    cf_ips.append(ip_str)
            except ValueError:
                continue
        return cf_ips
