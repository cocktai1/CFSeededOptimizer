#!/usr/bin/env python3
"""Harvesting strategies for Cloudflare IP collection.

Provides pluggable strategies for different IP sourcing methods:
- DNS: Direct DNS resolution via socket API (stable, server-side)
- ITDog: Scraping from ITDog portal (supplementary, local-side)
- Future: Additional strategies (API-based, web scraping, etc.)
"""

from .base import BaseHarvester, StrategyResult
from .dns_harvester import DNSHarvester
from .itdog_harvester import ITDogHarvester

__all__ = [
    "BaseHarvester",
    "StrategyResult",
    "DNSHarvester",
    "ITDogHarvester",
]
