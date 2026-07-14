"""Admin v2 — bookings, sessions, users, marketplace, installed agents.

Additive layer on top of surface/admin.py. Shapes match the typed
frontend client at web/src/lib/api/admin-v2.ts. All routes gated by
the same admin bearer token as admin v1 via `require_admin`.
"""
from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from surface.admin import require_admin


# ─────────────────────────────────────────────────────────── helpers


def _session_status(last_ts: float) -> str:
    """Map last-activity age to the SessionStatus enum."""
    age = time.time() - last_ts
    if age < 5 * 60:
        return "active"
    if age < 60 * 60:
        return "idle"
    return "closed"


def _order_to_booking(order) -> dict[str, Any]:
    slot_iso = f"{order.date}T{order.slot}:00"
    return {
        "booking_id": order.order_id,
        "user_id": order.user_id,
        "business_id": order.place_id,
        "slot": slot_iso,
        "status": order.status,
        "idempotency_key": order.idempotency_key,
        "created_at": order.created_at,
    }


def _aggregate_sessions(tid: str, user_filter: str | None = None) -> list[dict[str, Any]]:
    from tenancy.audit import read_events

    by_sid: dict[str, dict[str, Any]] = {}
    for evt in read_events(tid):
        sid = evt.get("session_id")
        if not sid:
            continue
        uid = str(evt.get("user_id") or "")
        if user_filter and uid != user_filter:
            continue
        ts = evt.get("ts")
        if not isinstance(ts, (int, float)):
            continue
        row = by_sid.setdefault(str(sid), {
            "session_id": str(sid),
            "user_id": uid,
            "business_id": None,
            "message_count": 0,
            "last_message_at": float(ts),
            "started_at": float(ts),
        })
        row["message_count"] = int(row["message_count"]) + 1
        row["last_message_at"] = max(float(row["last_message_at"]), float(ts))
        row["started_at"] = min(float(row["started_at"]), float(ts))
        if uid and not row["user_id"]:
            row["user_id"] = uid

    out: list[dict[str, Any]] = []
    for row in by_sid.values():
        row["status"] = _session_status(float(row["last_message_at"]))
        out.append(row)
    out.sort(key=lambda r: float(r["last_message_at"]), reverse=True)
    return out


# ─────────────────────────────────────────────────────────── admin router


router = APIRouter(prefix="/v1/admin", dependencies=[Depends(require_admin)], tags=["admin_v2"])


@router.get("/tenants/{tid}/bookings")
def list_bookings(
    tid: str,
    status_: str | None = Query(default=None, alias="status"),
    user_id: str | None = None,
    since: float | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    from services.orders_store import orders_for

    orders, total = orders_for(tid).list_all(
        status=status_, user_id=user_id, since=since, limit=limit,
    )
    return {
        "bookings": [_order_to_booking(o) for o in orders],
        "total": total,
    }


@router.get("/tenants/{tid}/sessions")
def list_sessions(
    tid: str,
    user_id: str | None = None,
    limit: int | None = None,
) -> dict[str, Any]:
    sessions = _aggregate_sessions(tid, user_filter=user_id)
    total = len(sessions)
    if limit is not None:
        sessions = sessions[:limit]
    return {"sessions": sessions, "total": total}


@router.get("/tenants/{tid}/sessions/{sid}/transcript")
def get_transcript(tid: str, sid: str) -> dict[str, list[dict[str, Any]]]:
    from tenancy.audit import read_events

    entries: list[dict[str, Any]] = []
    seq = 0
    for evt in read_events(tid):
        if str(evt.get("session_id") or "") != sid:
            continue
        ts = evt.get("ts")
        if not isinstance(ts, (int, float)):
            continue
        seq += 1
        content = {k: v for k, v in evt.items() if k not in ("session_id", "role", "ts", "action")}
        entries.append({
            "seq": seq,
            "role": str(evt.get("role") or ""),
            "content": content,
            "action": evt.get("action") if isinstance(evt.get("action"), dict) else None,
            "at": float(ts),
        })
    entries.sort(key=lambda e: e["at"])
    for i, e in enumerate(entries, 1):
        e["seq"] = i
    return {"transcript": entries}


@router.get("/tenants/{tid}/users")
def list_users(tid: str) -> dict[str, list[dict[str, Any]]]:
    from tenancy.audit import read_events
    from services.orders_store import orders_for

    per_user: dict[str, dict[str, Any]] = {}
    sessions_by_user: dict[str, set[str]] = {}
    for evt in read_events(tid):
        uid = str(evt.get("user_id") or "")
        if not uid:
            continue
        ts = evt.get("ts")
        if not isinstance(ts, (int, float)):
            continue
        row = per_user.setdefault(uid, {
            "user_id": uid,
            "first_seen": float(ts),
            "last_seen": float(ts),
            "sessions": 0,
            "bookings": 0,
        })
        row["first_seen"] = min(float(row["first_seen"]), float(ts))
        row["last_seen"] = max(float(row["last_seen"]), float(ts))
        sid = evt.get("session_id")
        if sid:
            sessions_by_user.setdefault(uid, set()).add(str(sid))

    for uid, sids in sessions_by_user.items():
        per_user[uid]["sessions"] = len(sids)

    orders, _ = orders_for(tid).list_all(status=None, user_id=None, since=None, limit=None)
    for o in orders:
        row = per_user.setdefault(o.user_id, {
            "user_id": o.user_id,
            "first_seen": float(o.created_at),
            "last_seen": float(o.created_at),
            "sessions": 0,
            "bookings": 0,
        })
        row["bookings"] = int(row["bookings"]) + 1
        row["first_seen"] = min(float(row["first_seen"]), float(o.created_at))
        row["last_seen"] = max(float(row["last_seen"]), float(o.created_at))

    users = sorted(per_user.values(), key=lambda r: float(r["last_seen"]), reverse=True)
    return {"users": users}


@router.get("/tenants/{tid}/users/{uid}")
def get_user(tid: str, uid: str) -> dict[str, Any]:
    from services.orders_store import orders_for

    orders = orders_for(tid).list_for_user(uid)
    bookings = [_order_to_booking(o) for o in orders]
    sessions = _aggregate_sessions(tid, user_filter=uid)
    return {"user_id": uid, "bookings": bookings, "sessions": sessions}


# ─────────────────────────────────────────────────────────── marketplace + installed agents


_MARKETPLACE_CATALOG: list[dict[str, Any]] = [
    {
        "slug": "reservations",
        "display_name": "Reservations",
        "description": "Table reservations for restaurants and bars.",
        "vertical": "restaurant,bar",
        "tools": ["check_availability", "create_booking", "cancel_booking"],
        "default_config": {"confirm_before_mutation": True, "max_steps": 1},
    },
    {
        "slug": "appointments",
        "display_name": "Appointments",
        "description": "Appointment booking for doctors, salons, and spas.",
        "vertical": "doctor,salon,spa",
        "tools": ["check_availability", "create_booking", "cancel_booking"],
        "default_config": {"confirm_before_mutation": True, "max_steps": 1},
    },
    {
        "slug": "menu",
        "display_name": "Menu lookup",
        "description": "Fetch and answer questions about a restaurant menu.",
        "vertical": "restaurant",
        "tools": ["fetch_menu"],
        "default_config": {"confirm_before_mutation": True, "max_steps": 1},
    },
    {
        "slug": "inventory",
        "display_name": "Inventory",
        "description": "Stock queries and refill requests for pharmacy and grocery.",
        "vertical": "pharmacy,grocery",
        "tools": ["stock_query", "refill_request"],
        "default_config": {"confirm_before_mutation": True, "max_steps": 1},
    },
    {
        "slug": "membership",
        "display_name": "Membership",
        "description": "Plan lookups and gym membership signups.",
        "vertical": "gym",
        "tools": ["plans_query", "signup"],
        "default_config": {"confirm_before_mutation": True, "max_steps": 1},
    },
    {
        "slug": "concierge",
        "display_name": "Concierge",
        "description": "Hours, address and general lookup across verticals.",
        "vertical": "restaurant,doctor,salon,pharmacy,gym",
        "tools": ["lookup_hours", "lookup_address"],
        "default_config": {"confirm_before_mutation": True, "max_steps": 1},
    },
]


marketplace_router = APIRouter(prefix="/v1/marketplace", tags=["marketplace"])


@marketplace_router.get("/agents")
def marketplace_agents(vertical: str | None = None) -> dict[str, list[dict[str, Any]]]:
    if not vertical:
        return {"agents": list(_MARKETPLACE_CATALOG)}
    verticals = {v.strip() for v in vertical.split(",") if v.strip()}
    agents = [
        a for a in _MARKETPLACE_CATALOG
        if verticals.intersection({v.strip() for v in a["vertical"].split(",")})
    ]
    return {"agents": agents}


def _installed_row_to_dict(row) -> dict[str, Any]:
    return {
        "slug": row.slug,
        "enabled": row.enabled,
        "config": dict(row.config or {}),
        "installed_at": row.installed_at,
        "last_used_at": row.last_used_at,
        "conversation_count": row.conversation_count,
    }


class AgentPatch(BaseModel):
    enabled: bool | None = None
    config: dict[str, Any] | None = None


@router.get("/tenants/{tid}/agents")
def list_installed_agents(tid: str) -> dict[str, list[dict[str, Any]]]:
    from services.installed_agents import installed_agents_for
    rows = installed_agents_for(tid).list()
    return {"agents": [_installed_row_to_dict(r) for r in rows]}


@router.post("/tenants/{tid}/agents/{slug}", status_code=status.HTTP_201_CREATED)
def install_agent(tid: str, slug: str) -> dict[str, Any]:
    from services.installed_agents import installed_agents_for
    default_config: dict[str, Any] = {}
    for entry in _MARKETPLACE_CATALOG:
        if entry["slug"] == slug:
            default_config = dict(entry["default_config"])
            break
    row = installed_agents_for(tid).install(slug, default_config=default_config)
    return _installed_row_to_dict(row)


@router.patch("/tenants/{tid}/agents/{slug}")
def patch_agent(tid: str, slug: str, body: AgentPatch) -> dict[str, Any]:
    from services.installed_agents import installed_agents_for
    row = installed_agents_for(tid).patch(slug, enabled=body.enabled, config=body.config)
    if not row:
        raise HTTPException(404, f"agent {slug!r} not installed")
    return _installed_row_to_dict(row)


@router.delete("/tenants/{tid}/agents/{slug}", status_code=status.HTTP_204_NO_CONTENT)
def uninstall_agent(tid: str, slug: str) -> None:
    from services.installed_agents import installed_agents_for
    ok = installed_agents_for(tid).uninstall(slug)
    if not ok:
        raise HTTPException(404, f"agent {slug!r} not installed")
