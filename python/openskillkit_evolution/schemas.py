from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from hashlib import sha256
from typing import Any


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def short_hash(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()[:16]


@dataclass
class OpenWorldTask:
    title: str
    prompt: str
    forbidden_identifiers: list[str] = field(default_factory=list)
    forbidden_paths: list[str] = field(default_factory=list)
    task_type: str = "general"
    allow_web: bool = False
    created_at: str = field(default_factory=now_iso)
    id: str | None = None

    def to_json(self) -> dict[str, Any]:
        task_id = self.id or f"owtask_{short_hash(f'{self.title}:{self.prompt}:{self.created_at}')}"
        return {
            "schemaVersion": "openskill-kit.openworld-task.v1",
            "id": task_id,
            "title": self.title,
            "prompt": self.prompt,
            "createdAt": self.created_at,
            "status": "draft",
            "privacyClass": "project-private",
            "taskType": self.task_type,
            "languages": [],
            "paths": [],
            "forbiddenIdentifiers": self.forbidden_identifiers,
            "forbiddenPaths": self.forbidden_paths,
            "allowWeb": self.allow_web,
            "notes": ["Python OpenWorld engine scaffold; no web retrieval or LLM generation yet."]
        }


def placeholder_source(task_id: str, content: str, *, source_id: str = "src_placeholder") -> dict[str, Any]:
    return {
        "schemaVersion": "openskill-kit.openworld-source.v1",
        "id": source_id,
        "taskId": task_id,
        "kind": "generated-placeholder",
        "uri": "local://placeholder",
        "title": "Local scaffold placeholder",
        "retrievedAt": now_iso(),
        "contentHash": sha256(content.encode("utf-8")).hexdigest(),
        "trust": {"authority": 0.2, "freshness": 0.5, "independence": 0.2, "rationale": "Generated scaffold placeholder, not research evidence."},
        "privacyClass": "project-private",
        "usableFor": ["report"],
        "leakageAuditId": None
    }


def placeholder_anchor(task_id: str, source_id: str, claim: str) -> dict[str, Any]:
    return {
        "schemaVersion": "openskill-kit.anchor-card.v1",
        "id": f"anc_{short_hash(f'{task_id}:{source_id}:{claim}')}",
        "taskId": task_id,
        "sourceId": source_id,
        "claim": claim,
        "anchorType": "constraint",
        "verifiableAs": ["manual-review"],
        "paths": [],
        "confidence": 0.35,
        "leakageRisk": "low",
        "privacyClass": "project-private",
        "usableFor": ["safety", "report"],
        "createdAt": now_iso()
    }


def placeholder_suite(task_id: str, anchor_id: str) -> dict[str, Any]:
    return {
        "schemaVersion": "openskill-kit.virtual-test-suite.v1",
        "id": f"vts_{short_hash(f'{task_id}:{anchor_id}')}",
        "taskId": task_id,
        "createdAt": now_iso(),
        "generatedFromAnchorIds": [anchor_id],
        "cases": [{
            "id": f"case_{short_hash(anchor_id)}",
            "anchorIds": [anchor_id],
            "runner": "manual",
            "split": "visible",
            "name": "Manual scaffold review",
            "description": "Confirm no hidden oracle content is present before future verifier generation.",
            "command": [],
            "assertions": ["Leakage audit status is pass."],
            "expectedArtifacts": [],
            "status": "draft"
        }],
        "leakageAuditId": None
    }


def placeholder_skill_plan(task_id: str, anchor_id: str) -> dict[str, Any]:
    return {
        "schemaVersion": "openskill-kit.skill-plan.v1",
        "id": f"skp_{short_hash(f'{task_id}:{anchor_id}')}",
        "taskId": task_id,
        "createdAt": now_iso(),
        "objective": "Prepare a verifier-first skill plan after real retrieval and anchors exist.",
        "sourceIds": [],
        "anchorIds": [anchor_id],
        "constraints": ["No web access unless explicitly enabled.", "No hidden oracle content in generated artifacts."],
        "candidateSkillNames": [],
        "maxRefinementRounds": 3,
        "status": "draft"
    }


def placeholder_run(task_id: str, anchor_id: str, suite_id: str, plan_id: str, audit_id: str) -> dict[str, Any]:
    return {
        "schemaVersion": "openskill-kit.evolution-run.v1",
        "id": f"owrun_{short_hash(f'{task_id}:{now_iso()}')}",
        "taskId": task_id,
        "startedAt": now_iso(),
        "completedAt": now_iso(),
        "status": "planned",
        "maxRounds": 3,
        "rounds": [{
            "index": 0,
            "status": "planned",
            "verifierSuiteId": suite_id,
            "skillPlanId": plan_id,
            "notes": ["Scaffold only; no LLM generation or sandbox execution yet."]
        }],
        "sourceIds": [],
        "anchorIds": [anchor_id],
        "virtualTestSuiteIds": [suite_id],
        "leakageAuditIds": [audit_id],
        "cost": {"wallClockMs": 0, "estimatedTokens": 0}
    }
