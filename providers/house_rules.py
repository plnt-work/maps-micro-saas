"""House-rules provider — schedule-driven adapter for merchants without a
third-party booking backend. Reads a JSON schedule from tenant integrations
and generates slot candidates locally.

Schedule schema:
    {
      "open_hours": {"mon": [["11:00","22:00"]], "tue": [["11:00","22:00"]], ...},
      "closed_dates": ["2026-08-15", ...],
      "turn_minutes": 90,
      "party_size_range": [1, 8]
    }
"""
from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from providers.base import ProviderAdapter, ProviderCandidate, ProviderResult


_DOW = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


class HouseRulesAdapter(ProviderAdapter):
    name = "house_rules"

    def __init__(self, schedule: dict[str, Any] | None = None) -> None:
        self._schedule = schedule or {}

    def is_configured(self) -> bool:
        return bool(self._schedule.get("open_hours"))

    def search(self, *, query: str, near: str = "", limit: int = 5) -> list[ProviderCandidate]:
        # House-rules doesn't discover — the merchant IS the candidate.
        # Caller supplies name/place via the provider_id path.
        return [ProviderCandidate(
            provider=self.name, provider_id=query or "house", name=query or "",
        )]

    def availability(self, *, provider_id: str, date_iso: str, party_size: int = 2) -> list[str]:
        if date_iso in set(self._schedule.get("closed_dates") or []):
            return []
        try:
            d = date.fromisoformat(date_iso)
        except ValueError:
            return []
        lo, hi = self._schedule.get("party_size_range") or [1, 99]
        if not (int(lo) <= party_size <= int(hi)):
            return []
        windows = (self._schedule.get("open_hours") or {}).get(_DOW[d.weekday()]) or []
        turn = int(self._schedule.get("turn_minutes") or 60)
        out: list[str] = []
        for w in windows:
            if not (isinstance(w, (list, tuple)) and len(w) == 2):
                continue
            try:
                start_t = time.fromisoformat(str(w[0]))
                end_t = time.fromisoformat(str(w[1]))
            except ValueError:
                continue
            cur = datetime.combine(d, start_t)
            end = datetime.combine(d, end_t)
            while cur < end:
                out.append(cur.isoformat())
                cur += timedelta(minutes=turn)
        return out

    def book(
        self, *, provider_id: str, slot: str, user_contact: str,
        party_size: int = 2, idempotency_key: str = "",
    ) -> ProviderResult:
        return ProviderResult(
            kind="house_confirmed", provider=self.name,
            provider_ref=idempotency_key or slot,
            metadata={
                "slot": slot, "party_size": party_size,
                "confirmed_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    def cancel(self, *, provider_ref: str, reason: str = "") -> ProviderResult:
        return ProviderResult(
            kind="house_confirmed", provider=self.name,
            provider_ref=provider_ref, note="cancelled",
        )
