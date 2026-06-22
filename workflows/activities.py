"""Temporal Activities — the boundary between deterministic Workflow code
and the actual micro-agent invocation.

`run_microagent` is the only Activity for slice 1. It:
  1. Loads the skill bundle from plnt-cloud/microagents/skills/<role>/
  2. Builds an AgentSpec with the tenant context injected into `inputs`
  3. Preloads recent Memori context for (tenant, user, role)
  4. Invokes plnt's `runner.run_spec(spec)` IN-PROCESS (Activities are
     non-deterministic; this is the right place to call the LLM)
  5. Persists the assistant turn back to Memori
  6. Returns the structured output

Activities are independently retryable. Temporal records inputs/outputs for
replay; the Activity itself can be killed and re-invoked safely as long as
the underlying operations are idempotent. Slice 1 stubs are pure — naturally
idempotent. Slice 2 will add idempotency keys for `create_booking`.
"""
from __future__ import annotations

import json
import os
import uuid
from dataclasses import dataclass, field, asdict
from typing import Any

from temporalio import activity

from tenancy.audit import write_event as audit_write
from tenancy.context import TenantContext, set_current_tenant, reset_current_tenant
from tenancy.factory import for_tenant
from memory.preload import preload_memory_into_inputs, remember_turn
from microagents.loader import load_skill
from services import places as places_svc
from workflows.bookings_store import bookings_for
from workflows.saga_booking import deterministic_booking_id


# ─────────────────────────────────────────────────────────── DTOs


@dataclass
class MicroagentRequest:
    tenant_id: str
    user_id: str
    session_id: str
    role: str
    inputs: dict[str, Any] = field(default_factory=dict)
    # Optional override of which LLM backend to use (e.g. "offline" in tests).
    force_backend: str | None = None


@dataclass
class MicroagentResult:
    role: str
    output: dict[str, Any]
    steps: int = 0
    error: str | None = None


def _build_spec(req: MicroagentRequest, skill_prompt: str, model_hint: str,
                isolation: str, budget_tokens: int, budget_wall: int):
    """Construct a plnt AgentSpec from the request + loaded skill metadata."""
    from plnt.execution.spec import AgentSpec, Budget

    run_id = f"r-{uuid.uuid4().hex[:10]}"
    ctx = TenantContext(req.tenant_id, req.user_id, req.session_id)

    inputs: dict[str, Any] = {
        **req.inputs,
        **ctx.to_inputs(),
        "skill_prompt": skill_prompt,
        # Pre-classified intent flows through as the "intent" key so the
        # runner's _wrap_user_message includes it in the user prompt.
        "intent": req.inputs.get("intent")
                  or req.inputs.get("text")
                  or json.dumps(req.inputs, default=str),
        # Force one-shot. All our skill prompts say "FINAL: <json> only" —
        # any tool round-trip just adds 2–3s of wasted Gemini latency.
        "max_steps": 1,
    }

    spec = AgentSpec(
        role=req.role,
        run_id=run_id,
        inputs=inputs,
        model_hint=model_hint if model_hint in ("small", "deep", "auto") else "auto",
        isolation=isolation if isolation in ("process", "docker", "gvisor", "microvm", "wasm") else "process",
        budget=Budget(tokens=budget_tokens, wall_seconds=budget_wall),
    )
    return spec, ctx


# ─────────────────────────────────────────────────────────── activities


@activity.defn(name="run_microagent")
async def run_microagent(req_dict: dict[str, Any]) -> dict[str, Any]:
    """Run one micro-agent to completion. Returns a MicroagentResult dict.

    Note: takes/returns dicts (not dataclasses) so Temporal's default
    JSON converter doesn't require custom type registration.
    """
    req = MicroagentRequest(**req_dict)

    # 1. Per-tenant bundle (cached).
    bundle = for_tenant(req.tenant_id)

    # 2. Load the skill bundle from plnt-cloud's catalog.
    try:
        skill = load_skill(req.role)
    except FileNotFoundError as e:
        result = asdict(MicroagentResult(role=req.role, output={}, error=str(e)))
        audit_write(
            tenant_id=req.tenant_id, session_id=req.session_id, user_id=req.user_id,
            role=req.role, status="error", has_output=False, detail=str(e),
        )
        return result

    # 3. Build spec.
    spec, ctx = _build_spec(
        req,
        skill_prompt=skill.prompt,
        model_hint=skill.model_hint,
        isolation=skill.isolation,
        budget_tokens=skill.budget_tokens,
        budget_wall=skill.budget_wall_seconds,
    )

    # 4. Preload Memori context into spec.inputs, then promote it to a
    # prefix on the LLM's user prompt so Gemini actually sees it.
    preload_memory_into_inputs(spec, ctx, bundle.memori)
    _inject_memory_into_prompt(spec)

    # 5. Bind current tenant for any code that consults the ContextVar.
    token = set_current_tenant(ctx)
    try:
        # Optional backend override (used by tests).
        if req.force_backend:
            os.environ["PLNT_FORCE"] = req.force_backend

        # 6. In-process invocation — plnt's extracted run_spec() callable.
        # Activities are non-deterministic; calling the LLM here is correct.
        from plnt.execution.runner import run_spec
        try:
            result = run_spec(spec, install_sigterm=False)
        except Exception as e:  # noqa: BLE001 — Activity-level outer catch
            activity.logger.exception("run_spec failed for role=%s", req.role)
            err_result = asdict(MicroagentResult(role=req.role, output={}, error=str(e)))
            audit_write(
                tenant_id=req.tenant_id, session_id=req.session_id, user_id=req.user_id,
                role=req.role, status="error", has_output=False, detail=str(e),
            )
            return err_result

        # 7. Parse the structured output. Skills emit FINAL: <json> as their
        # answer; pull the JSON out when present.
        output = _extract_structured_output(result)

        # 7b. Ground booking writes in the per-tenant BookingsStore.
        # Otherwise Gemini's invented booking_id is the only record — no
        # idempotency, no audit ledger, no admin-side count.
        if req.role == "create_booking" and output:
            output = _ground_create_booking(req, spec.inputs, output)
        elif req.role == "cancel_booking" and output:
            output = _ground_cancel_booking(req, spec.inputs, output)
        elif req.role == "resolve_business" and output:
            # Overlay Places API results when available — Gemini's
            # world-knowledge candidates become a fallback.
            output = _ground_resolve_business(spec.inputs, output)

        # 8. Persist the turn back to Memori for next time.
        if output:
            remember_turn(
                bundle.memori, ctx,
                role=req.role, turn_role="assistant",
                content=json.dumps(output, default=str),
            )

        final = asdict(MicroagentResult(
            role=req.role,
            output=output,
            steps=int(result.get("steps", 0)),
        ))
        audit_write(
            tenant_id=req.tenant_id, session_id=req.session_id, user_id=req.user_id,
            role=req.role, status="ok", has_output=bool(output),
        )
        return final
    finally:
        reset_current_tenant(token)


@activity.defn(name="notify_booking")
async def notify_booking(req_dict: dict[str, Any]) -> dict[str, Any]:
    """Production notification step for the booking saga.

    Slice 2 is a no-op success — real SMS / email / push integrations land
    in slice 3+ behind tenant-specific adapters. The Workflow doesn't care:
    success = saga commits; raise = saga compensates via cancel_booking.
    """
    activity.logger.info(
        "notify_booking (no-op): tenant=%s session=%s booking_id=%s",
        req_dict.get("tenant_id"),
        req_dict.get("session_id"),
        req_dict.get("booking_id"),
    )
    return {
        "sent": True,
        "channel": "noop",
        "booking_id": req_dict.get("booking_id"),
    }


def _inject_memory_into_prompt(spec) -> None:  # type: ignore[no-untyped-def]
    """Surface recalled Memori turns to the LLM by prepending them to the
    `intent` field that runner's _wrap_user_message renders.

    The runner doesn't know about memory_context — it only renders the intent
    + workdir into the user prompt. So we encode memory there. Mutation in
    place is safe: spec.inputs is the open dict plnt explicitly hands us.
    """
    mem = spec.inputs.get("memory_context") or []
    if not isinstance(mem, list) or not mem:
        return
    lines = []
    for m in mem[-5:]:  # keep prompt small
        role = str(m.get("role", "")).strip() or "?"
        content = str(m.get("content", "")).strip()
        if content:
            lines.append(f"  - [{role}] {content[:200]}")
    if not lines:
        return
    prior = "PRIOR CONVERSATION CONTEXT (most recent first):\n" + "\n".join(lines)
    intent = str(spec.inputs.get("intent") or "")
    spec.inputs["intent"] = f"{prior}\n\nCURRENT TASK:\n{intent}"


def _ground_resolve_business(
    inputs: dict[str, Any], output: dict[str, Any],
) -> dict[str, Any]:
    """When Places API is enabled, replace Gemini's candidate list with real
    Places results (real name, address, lat/lng, stable Place ID). When
    disabled or empty, keep Gemini's output unchanged.

    Picks the richest signal available:
      1. `user_text` (the original message) — has the full context like
         "pizza places in mumbai"
      2. `business_query` — what classify_intent extracted
    """
    query = (
        str(inputs.get("user_text") or "").strip()
        or str(inputs.get("business_query") or "").strip()
    )
    if not query or not places_svc.is_enabled():
        return output

    hits = places_svc.search(query, max_results=5)
    if not hits:
        # Places enabled but returned nothing (rare query, or API hiccup) →
        # fall back to whatever Gemini produced.
        return output

    candidates = [
        {
            "name": p.name,
            "neighborhood": "",  # Places' addr line already includes it
            "city": "",
            "category": (p.types[0] if p.types else ""),
            "place_id": p.place_id,
            "address": p.address,
            "lat": p.latitude,
            "lng": p.longitude,
        }
        for p in hits
    ]
    # Only auto-pick when there's a single result; otherwise let the user
    # disambiguate via show_candidates in the synthesizer.
    best = candidates[0] if len(candidates) == 1 else None
    return {
        **output,
        "candidates": candidates,
        "best_match": best,
        "confidence": 0.9 if best else 0.75,
        "needs_disambiguation": best is None,
        "source": "places",
    }


def _ground_create_booking(
    req: MicroagentRequest, inputs: dict[str, Any], output: dict[str, Any],
) -> dict[str, Any]:
    """Replace Gemini's invented booking_id with a deterministic one, then
    persist to the per-tenant BookingsStore so idempotency holds across
    Activity retries.
    """
    idem = str(inputs.get("idempotency_key") or "")
    if not idem:
        return output
    booking_id = deterministic_booking_id(idem)
    store = bookings_for(req.tenant_id)
    bid, was_new = store.upsert_confirmed(
        idempotency_key=idem,
        booking_id=booking_id,
        business_id=str(inputs.get("business_id") or ""),
        slot=str(inputs.get("slot") or ""),
        user_contact=str(inputs.get("user_contact") or ""),
    )
    return {
        **output,
        "booking_id": bid,
        "status": "confirmed",
        "note": (output.get("note") or "") + ("" if was_new else " (idempotent retry)"),
    }


def _ground_cancel_booking(
    req: MicroagentRequest, inputs: dict[str, Any], output: dict[str, Any],
) -> dict[str, Any]:
    booking_id = str(inputs.get("booking_id") or output.get("booking_id") or "")
    if not booking_id:
        return output
    status = bookings_for(req.tenant_id).cancel(
        booking_id, str(inputs.get("reason") or ""),
    )
    return {**output, "booking_id": booking_id, "status": status}


def _extract_structured_output(result: dict[str, Any]) -> dict[str, Any]:
    """Pull the structured JSON out of a runner result.

    The runner returns `{"answer": "<text>", "steps": N, "transcript": [...]}`.
    Skill prompts instruct the model to emit `FINAL: {...json...}`. The
    runner strips the `FINAL:` prefix and stores the rest as `answer`.

    We try to parse `answer` as JSON. If it's free text, wrap it in
    `{"answer": <text>}` so the Workflow always sees a dict.
    """
    ans = (result or {}).get("answer", "")
    if not isinstance(ans, str):
        return {"answer": ans} if ans else {}
    ans = ans.strip()
    if not ans:
        return {}
    # If it starts with { or [ try to parse.
    if ans[0] in "{[":
        try:
            parsed = json.loads(ans)
            if isinstance(parsed, dict):
                return parsed
            return {"answer": parsed}
        except json.JSONDecodeError:
            pass
    return {"answer": ans}
