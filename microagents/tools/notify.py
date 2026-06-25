"""notify_send — placeholder for per-tenant notification adapters.

Slice 2 left `notify_booking` as a no-op activity. The tool form keeps the
adapter contract explicit so when real Resend/Postmark/Twilio integrations
land they slot in behind this single name without changing the saga.

For now it returns {sent: true, channel: 'noop'} like the prior activity.
The audit log carries the channel + booking_id so test assertions still hold.
"""
from __future__ import annotations

from typing import Any

from tenancy.context import TenantContext

from microagents.tools import Tool, register


_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "booking_id": {"type": "string", "description": "Booking id to attach to the notification."},
        "channel": {
            "type": "string",
            "description": "Preferred channel hint (sms|email|push). Adapter may override.",
        },
        "message": {"type": "string", "description": "Pre-rendered message body, when known."},
    },
    "required": ["booking_id"],
}


def _notify_send(
    ctx: TenantContext,
    *,
    booking_id: str,
    channel: str = "noop",
    message: str = "",
) -> dict[str, Any]:
    """No-op. Real per-tenant adapter dispatch lives in MA-P4."""
    return {
        "sent": True,
        "channel": channel or "noop",
        "booking_id": booking_id,
        "tenant_id": ctx.tenant_id,
    }


register(Tool(
    name="notify_send",
    description=(
        "Send a booking notification through the tenant's configured adapter. "
        "Currently a no-op (adapters land in MA-P4); returns sent=true so the "
        "saga commits."
    ),
    schema=_SCHEMA,
    fn=_notify_send,
))
