"""notify_send — real Expo push dispatch.

Looks up the tenant/user's Expo push token via
`services.push_tokens.push_tokens_for(...)` and pushes through
`services.expo_push.send_expo_push`. Silent on delivery failure — the
saga's `notify_booking` activity is what decides whether to compensate.

Missing token → returns channel="no-token" and sent=False. Do NOT raise:
the send happens best-effort so a missing device doesn't kill the saga.
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
        "title": {"type": "string", "description": "Notification title (overrides default)."},
        "message": {"type": "string", "description": "Pre-rendered message body, when known."},
        "status_label": {"type": "string", "description": "Status verb, defaults to 'confirmed'."},
    },
    "required": ["booking_id"],
}


def _notify_send(
    ctx: TenantContext,
    *,
    booking_id: str,
    channel: str = "push",
    title: str = "",
    message: str = "",
    status_label: str = "confirmed",
) -> dict[str, Any]:
    from services.push_tokens import push_tokens_for
    from services.expo_push import send_expo_push

    token = push_tokens_for(ctx.tenant_id).get(ctx.user_id)
    if not token:
        return {
            "sent": False,
            "channel": "no-token",
            "booking_id": booking_id,
            "tenant_id": ctx.tenant_id,
        }

    resolved_title = title or f"Booking {status_label or 'confirmed'}"
    resolved_body = message or f"Booking {booking_id} is confirmed."
    push_result = send_expo_push(
        tokens=[token.expo_token],
        title=resolved_title,
        body=resolved_body,
        data={"booking_id": booking_id, "kind": "booking_confirmed"},
    )
    return {
        **push_result,
        "booking_id": booking_id,
        "tenant_id": ctx.tenant_id,
    }


register(Tool(
    name="notify_send",
    description=(
        "Send a booking notification through the tenant's configured adapter. "
        "Currently pushes via Expo when a device token is registered; returns "
        "sent=False + channel='no-token' when the user has no registered device "
        "so the saga still commits."
    ),
    schema=_SCHEMA,
    fn=_notify_send,
))
