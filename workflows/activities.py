"""Temporal Activities — the boundary between deterministic Workflow code
and the actual micro-agent invocation.

`run_microagent` loads a skill bundle, builds the inputs, and dispatches to
`microagents.agent_loop.run_skill` — the Gemini-native function-calling loop.
There is no post-hoc grounding here anymore: the model calls real tools
(places_text_search, bookings_upsert, bookings_cancel, notify_send) during
its own loop, and tool results feed back into its context the way
Anthropic/OpenAI/Google agent docs prescribe.

`notify_booking` is a thin Activity that calls the `notify_send` tool
directly (no LLM). The saga's `notify_booking` step exists so Temporal
retries/timeouts apply at the right granularity even though no model is
involved in this step.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from typing import Any

from temporalio import activity

from memory.preload import remember_turn
from microagents.agent_loop import run_skill
from microagents.loader import load_skill
from microagents.tools import dispatch as dispatch_tool
from tenancy.audit import write_event as audit_write
from tenancy.context import TenantContext, set_current_tenant, reset_current_tenant
from tenancy.factory import for_tenant


# ─────────────────────────────────────────────────────────── DTOs


@dataclass
class MicroagentRequest:
    tenant_id: str
    user_id: str
    session_id: str
    role: str
    inputs: dict[str, Any] = field(default_factory=dict)
    # Optional override of which LLM backend to use. Currently ignored by the
    # cloud agent loop (always calls Gemini); kept on the request so the
    # stub_activities path stays signature-compatible.
    force_backend: str | None = None


@dataclass
class MicroagentResult:
    role: str
    output: dict[str, Any]
    steps: int = 0
    error: str | None = None


# ─────────────────────────────────────────────────────────── activities


@activity.defn(name="run_microagent")
async def run_microagent(req_dict: dict[str, Any]) -> dict[str, Any]:
    """Run one micro-agent to completion. Returns a MicroagentResult dict.

    Takes/returns dicts (not dataclasses) so Temporal's default JSON
    converter doesn't require custom type registration.
    """
    req = MicroagentRequest(**req_dict)

    bundle = for_tenant(req.tenant_id)

    try:
        skill = load_skill(req.role)
    except FileNotFoundError as e:
        result = asdict(MicroagentResult(role=req.role, output={}, error=str(e)))
        audit_write(
            tenant_id=req.tenant_id, session_id=req.session_id, user_id=req.user_id,
            role=req.role, status="error", has_output=False, detail=str(e),
        )
        return result

    ctx = TenantContext(req.tenant_id, req.user_id, req.session_id)
    token = set_current_tenant(ctx)
    try:
        loop_result = run_skill(
            skill,
            ctx=ctx,
            inputs=dict(req.inputs),
            memori=bundle.memori,
        )

        if loop_result.error:
            activity.logger.warning(
                "skill %s failed: %s", req.role, loop_result.error,
            )
            audit_write(
                tenant_id=req.tenant_id, session_id=req.session_id, user_id=req.user_id,
                role=req.role, status="error", has_output=bool(loop_result.output),
                detail=loop_result.error,
            )
        else:
            # Persist the turn back to Memori so the next call for this
            # (user, role) can recall it.
            if loop_result.output:
                remember_turn(
                    bundle.memori, ctx,
                    role=req.role, turn_role="assistant",
                    content=json.dumps(loop_result.output, default=str),
                )
            audit_write(
                tenant_id=req.tenant_id, session_id=req.session_id, user_id=req.user_id,
                role=req.role, status="ok", has_output=bool(loop_result.output),
            )

        return asdict(MicroagentResult(
            role=req.role,
            output=loop_result.output,
            steps=loop_result.steps,
            error=loop_result.error,
        ))
    finally:
        reset_current_tenant(token)


@activity.defn(name="notify_booking")
async def notify_booking(req_dict: dict[str, Any]) -> dict[str, Any]:
    """Saga step — dispatches the `notify_send` tool directly (no LLM).

    The tool is a no-op today; real per-tenant adapter dispatch lands in
    MA-P4. Failure raises so the saga compensates via cancel_booking.
    """
    tenant_id = str(req_dict.get("tenant_id") or "")
    user_id = str(req_dict.get("user_id") or "")
    session_id = str(req_dict.get("session_id") or "")
    booking_id = str(req_dict.get("booking_id") or "")
    ctx = TenantContext(tenant_id, user_id, session_id)
    result = dispatch_tool("notify_send", ctx, {
        "booking_id": booking_id,
        "channel": str(req_dict.get("channel") or "noop"),
        "message": str(req_dict.get("message") or ""),
    })
    activity.logger.info(
        "notify_booking: tenant=%s session=%s booking_id=%s channel=%s",
        tenant_id, session_id, booking_id, result.get("channel"),
    )
    return result
