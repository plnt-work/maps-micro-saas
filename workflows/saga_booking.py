"""Booking saga — invoked by ConversationWorkflow when intent kind=confirm.

Implements the saga pattern:
  1. create_booking      (micro-agent, idempotency-keyed)
  2. notify_booking      (system Activity — could be SMS/email/push)
On any failure of step 2, the compensation runs:
  3. cancel_booking      (micro-agent, idempotent)

The saga is a deterministic async helper, not a Workflow itself — kept inline
in ConversationWorkflow's run context for slice 2 simplicity. A future
upgrade promotes it to a child Workflow when bookings span multiple sessions
or need their own audit/replay history.

Idempotency: the create_booking step receives `idempotency_key` derived from
(session_id, business_id, slot). Activity retries see the same key →
BookingsStore returns the existing booking_id, no duplicates.

Compensation: a try/except around the post-create steps. ApplicationError
escapes the saga; the parent workflow records it as a saga_failed reply so
the channel can surface the rollback to the user.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from temporalio import workflow
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError


@dataclass
class SagaInput:
    tenant_id: str
    user_id: str
    session_id: str
    business_id: str
    slot: str
    user_contact: str
    # Test hook: when set, the notify activity raises so compensation runs.
    force_fail_step: str | None = None
    force_backend: str | None = None


@dataclass
class SagaResult:
    booking_id: str | None
    status: str         # confirmed | compensated | failed
    note: str = ""


def idempotency_key(session_id: str, business_id: str, slot: str) -> str:
    """Stable derivation. Activity retries hit the same row in BookingsStore."""
    return f"{session_id}:{business_id}:{slot}"


def _booking_request(s: SagaInput) -> dict[str, Any]:
    key = idempotency_key(s.session_id, s.business_id, s.slot)
    return {
        "tenant_id": s.tenant_id,
        "user_id": s.user_id,
        "session_id": s.session_id,
        "role": "create_booking",
        "inputs": {
            "business_id": s.business_id,
            "slot": s.slot,
            "user_contact": s.user_contact,
            "idempotency_key": key,
        },
        "force_backend": s.force_backend,
    }


def _cancel_request(s: SagaInput, booking_id: str, reason: str) -> dict[str, Any]:
    return {
        "tenant_id": s.tenant_id,
        "user_id": s.user_id,
        "session_id": s.session_id,
        "role": "cancel_booking",
        "inputs": {"booking_id": booking_id, "reason": reason},
        "force_backend": s.force_backend,
    }


def _notify_request(s: SagaInput, booking_id: str) -> dict[str, Any]:
    return {
        "tenant_id": s.tenant_id,
        "user_id": s.user_id,
        "session_id": s.session_id,
        "booking_id": booking_id,
        "force_fail": s.force_fail_step == "notify",
    }


async def run_booking_saga(s: SagaInput) -> SagaResult:
    """Run the saga from inside a Temporal Workflow.

    Must be called from within a `@workflow.run` execution — uses
    `workflow.execute_activity`. Returns a SagaResult describing outcome.
    """
    retry = RetryPolicy(initial_interval=timedelta(seconds=1), maximum_attempts=3)

    # ─── step 1: create_booking ───
    create = await workflow.execute_activity(
        "run_microagent",
        args=[_booking_request(s)],
        start_to_close_timeout=timedelta(seconds=20),
        retry_policy=retry,
    )
    booking_output = create.get("output", {}) or {}
    booking_id = str(booking_output.get("booking_id") or "")
    if not booking_id:
        return SagaResult(
            booking_id=None, status="failed",
            note=f"create_booking returned no booking_id: {create.get('error') or 'unknown'}",
        )

    # ─── step 2: notify_booking (can fail → compensation) ───
    try:
        await workflow.execute_activity(
            "notify_booking",
            args=[_notify_request(s, booking_id)],
            start_to_close_timeout=timedelta(seconds=10),
            retry_policy=RetryPolicy(maximum_attempts=2),
        )
    except ActivityError as e:
        # ─── compensation: cancel_booking ───
        try:
            await workflow.execute_activity(
                "run_microagent",
                args=[_cancel_request(
                    s, booking_id,
                    reason=f"compensation: notify failed ({type(e).__name__})",
                )],
                start_to_close_timeout=timedelta(seconds=15),
                retry_policy=retry,
            )
        except ApplicationError:
            # Cancel itself failed — surface so a human can clean up.
            return SagaResult(
                booking_id=booking_id, status="failed",
                note="notify failed AND cancel failed — manual review required",
            )
        return SagaResult(
            booking_id=booking_id, status="compensated",
            note=f"notify failed; booking {booking_id} cancelled",
        )

    return SagaResult(
        booking_id=booking_id, status="confirmed",
        note="booking confirmed and notified",
    )


# ─────────────────────────────────────────────────────────── helpers


def deterministic_booking_id(idem_key: str) -> str:
    """Mirrors the create_booking stub's id derivation — used by the
    BookingsStore upsert path AND the cancel_booking compensation when it
    needs to recognise a booking by idempotency_key.
    """
    return "bk_" + hashlib.sha1(idem_key.encode()).hexdigest()[:12]
