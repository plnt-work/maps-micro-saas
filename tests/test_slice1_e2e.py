"""Slice-1 end-to-end test.

Covers:
  1. ConversationWorkflow drives the three-skill happy path end-to-end:
        classify_intent  →  resolve_business  →  check_availability
     We mock `run_microagent` at the Activity boundary so the test runs
     without Ollama / external LLMs. The real Activity is exercised by
     plnt's own runner tests.
  2. Tenant isolation: two tenants writing to Memori in parallel see no
     cross-contamination on recall.

Uses Temporal's WorkflowEnvironment.start_local() — boots a real Temporal
dev-server in-process via the bundled temporal CLI. No Docker required.
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Any

import pytest

from temporalio.client import Client
from temporalio.testing import WorkflowEnvironment
from temporalio.worker import Worker

from workflows.session import ConversationWorkflow, SessionInput
from workflows.stub_activities import stub_run_microagent


TASK_QUEUE = "plnt-cloud-test"


# ─────────────────────────────────────────────────────────── fixtures


@pytest.fixture
async def env() -> WorkflowEnvironment:
    """Boot a local Temporal server for the duration of the test."""
    async with await WorkflowEnvironment.start_local() as e:
        yield e


# ─────────────────────────────────────────────────────────── tests


async def test_book_flow_end_to_end(env: WorkflowEnvironment) -> None:
    """User sends a booking message; Workflow yields three replies."""
    client: Client = env.client
    wf_id = f"test-{uuid.uuid4().hex[:8]}"

    async with Worker(
        client,
        task_queue=TASK_QUEUE,
        workflows=[ConversationWorkflow],
        activities=[stub_run_microagent],
    ):
        handle = await client.start_workflow(
            ConversationWorkflow.run,
            SessionInput(
                tenant_id="demo",
                user_id="alice",
                session_id="sess1",
                force_backend="offline",
            ),
            id=wf_id,
            task_queue=TASK_QUEUE,
        )

        await handle.signal(
            "user_message",
            "find me an appointment at Joe's Pizza tomorrow at 7pm",
        )

        # Poll up to ~5s for all three replies to land.
        replies: list[dict[str, Any]] = []
        for _ in range(50):
            replies = await handle.query("replies_since", 0)
            if len(replies) >= 3:
                break
            await asyncio.sleep(0.1)

        assert len(replies) == 3, f"expected 3 replies, got {len(replies)}: {replies}"

        # Order matters — Workflow dispatches the chain sequentially.
        roles = [r["role"] for r in replies]
        assert roles == ["classify_intent", "resolve_business", "check_availability"]

        # check_availability produced non-empty slots.
        last = replies[-1]["content"]
        assert "slots" in last and len(last["slots"]) == 3

        # Workflow is still alive — sessions are long-lived.
        state = await handle.query("state")
        assert state["replies_total"] == 3
        assert state["closed"] is False

        await handle.signal("close")


async def test_tenant_isolation_in_memory_layer(tmp_path, monkeypatch) -> None:
    """Two tenants writing to Memori in parallel see no cross-contamination.

    This is a pure-Python test of the per-tenant Memori adapter — no Temporal
    needed. Pairs with the Workflow test above to give us coverage on both
    halves of the isolation story (Workflow boundary + memory partition).
    """
    monkeypatch.setenv("PLNT_CLOUD_HOME", str(tmp_path))
    monkeypatch.setenv("PLNT_CLOUD_MEMORY_BACKEND", "stub")

    # Re-import so the env vars take effect (factory and adapter cache on home).
    from memory import memori_adapter as ma
    from tenancy import factory as tf
    ma.clear_cache()
    tf.clear_cache()

    bundle_a = tf.for_tenant("acme")
    bundle_b = tf.for_tenant("globex")

    # Tenant A: alice talks to classify_intent.
    bundle_a.memori.remember(
        user_id="alice", role="classify_intent", session_id="s1",
        turn_role="user", content="book Joe's Pizza",
    )
    # Tenant B: same user_id, same role, different content.
    bundle_b.memori.remember(
        user_id="alice", role="classify_intent", session_id="s1",
        turn_role="user", content="DIFFERENT TENANT MESSAGE",
    )

    a_recall = bundle_a.memori.recall(user_id="alice", role="classify_intent")
    b_recall = bundle_b.memori.recall(user_id="alice", role="classify_intent")

    a_contents = {r["content"] for r in a_recall}
    b_contents = {r["content"] for r in b_recall}

    assert "book Joe's Pizza" in a_contents
    assert "DIFFERENT TENANT MESSAGE" not in a_contents, (
        "tenant A saw tenant B's writes — partition is broken"
    )
    assert "DIFFERENT TENANT MESSAGE" in b_contents
    assert "book Joe's Pizza" not in b_contents


async def test_memori_recall_returns_empty_when_no_history(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("PLNT_CLOUD_HOME", str(tmp_path))
    monkeypatch.setenv("PLNT_CLOUD_MEMORY_BACKEND", "stub")

    from memory import memori_adapter as ma
    from tenancy import factory as tf
    ma.clear_cache()
    tf.clear_cache()

    bundle = tf.for_tenant("fresh-tenant")
    out = bundle.memori.recall(user_id="nobody", role="any_skill")
    assert out == []
