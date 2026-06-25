"""Minimal skill loader for plnt-cloud bundles.

plnt has its own SkillRegistry that reads `$PLNT_HOME/skills/<role>/`. We
intentionally bypass it for slice 1 — plnt-cloud owns its skill catalog at
`plnt-cloud/microagents/skills/<role>/` so it ships with the package.

The loader returns the prompt text and a parsed manifest dict. The Activity
injects the prompt into `spec.inputs["skill_prompt"]`, which the runner
already honors (runner.py: `skill_md = spec.inputs.get("skill_prompt") or _default_skill_prompt(...)`).
"""
from __future__ import annotations

import sys
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover — pyproject pins >=3.11
    import tomli as tomllib

from microagents import SKILLS_DIR


@dataclass(frozen=True)
class LoadedSkill:
    role: str
    prompt: str
    manifest: dict[str, Any]

    @property
    def budget_tokens(self) -> int:
        return int(self.manifest.get("budget", {}).get("tokens", 8000))

    @property
    def budget_wall_seconds(self) -> int:
        return int(self.manifest.get("budget", {}).get("wall_seconds", 60))

    @property
    def model_hint(self) -> str:
        return str(self.manifest.get("runtime", {}).get("model_hint", "auto"))

    @property
    def isolation(self) -> str:
        return str(self.manifest.get("runtime", {}).get("default_isolation", "process"))

    @property
    def tools(self) -> list[str]:
        """Named tools the skill may call. Empty = single-shot prompt skill."""
        return list(self.manifest.get("runtime", {}).get("tools", []))

    @property
    def max_steps(self) -> int:
        """Maximum LLM rounds for this skill. Per skill type:
            classifier / synthesizer = 1
            retriever (resolve_business, check_availability) = 2-3
            transactor (create_booking, cancel_booking) = 3-4

        Read from `[runtime] max_steps`. Defaults to 1 (single-shot) so a
        skill that forgets to declare it can't accidentally burn budget.
        """
        return int(self.manifest.get("runtime", {}).get("max_steps", 1))

    @property
    def response_schema(self) -> dict[str, Any] | None:
        """JSON Schema for the final response, when declared.

        When set AND `tools` is empty, the agent loop forwards this to
        Gemini as response_format.json_schema for native structured output —
        no more relying on the "FINAL: <json>" prompt convention.
        """
        rs = self.manifest.get("response_schema")
        if isinstance(rs, dict) and rs:
            return rs
        return None


@lru_cache(maxsize=64)
def load_skill(role: str) -> LoadedSkill:
    """Read a skill bundle from disk. Cached per-process."""
    skill_dir = SKILLS_DIR / role
    if not skill_dir.is_dir():
        raise FileNotFoundError(f"skill bundle missing: {skill_dir}")
    prompt_path = skill_dir / "prompt.md"
    manifest_path = skill_dir / "skill.toml"
    if not prompt_path.exists() or not manifest_path.exists():
        raise FileNotFoundError(
            f"skill bundle incomplete: {skill_dir} (need prompt.md and skill.toml)"
        )
    prompt = prompt_path.read_text(encoding="utf-8")
    manifest = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
    return LoadedSkill(role=role, prompt=prompt, manifest=manifest)


def list_skills() -> list[str]:
    """All skill roles currently shipped with plnt-cloud."""
    return sorted(
        p.name for p in SKILLS_DIR.iterdir()
        if p.is_dir() and (p / "skill.toml").exists()
    )


def clear_cache() -> None:
    load_skill.cache_clear()
