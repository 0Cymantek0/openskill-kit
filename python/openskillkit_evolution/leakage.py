from __future__ import annotations

import re
from dataclasses import dataclass
from hashlib import sha256
from typing import Any

ORACLE_PATTERN = re.compile(r"\b(hidden[-_\s]?tests?|oracle|ground[-_\s]?truth|gold[-_\s]?answer|target[-_\s]?answer|reference[-_\s]?solution)\b", re.IGNORECASE)


@dataclass
class LeakagePolicy:
    task_id: str
    forbidden_identifiers: list[str]
    forbidden_paths: list[str]


def sanitize_query(query: str, policy: LeakagePolicy) -> str:
    sanitized = query
    for value in [*policy.forbidden_identifiers, *policy.forbidden_paths]:
        if value:
            sanitized = sanitized.replace(value, "[redacted]")
    sanitized = ORACLE_PATTERN.sub("[redacted]", sanitized)
    return " ".join(sanitized.split())


def audit_values(values: list[tuple[str, str, str]], policy: LeakagePolicy) -> dict[str, Any]:
    findings: list[dict[str, str]] = []
    sanitized_queries: list[dict[str, str]] = []
    for source, surface, value in values:
        if surface == "query":
            sanitized = sanitize_query(value, policy)
            sanitized_queries.append({"original": value, "sanitized": sanitized})
            if sanitized != value:
                findings.append(_finding("forbidden-query-token", "block", surface, source, "Query contained forbidden oracle or benchmark identifier.", value))
        for forbidden in policy.forbidden_identifiers:
            if forbidden and forbidden.lower() in value.lower():
                findings.append(_finding("forbidden-identifier", "block", surface, source, "Forbidden identifier appeared in artifact.", forbidden))
        for forbidden in policy.forbidden_paths:
            if forbidden and forbidden.lower() in value.lower():
                findings.append(_finding("forbidden-path", "block", surface, source, "Forbidden path appeared in artifact.", forbidden))
        match = ORACLE_PATTERN.search(value)
        if match:
            findings.append(_finding("oracle-marker", "block", surface, source, "Oracle or hidden benchmark marker appeared in artifact.", match.group(0)))
    return {
        "schemaVersion": "openskill-kit.openworld-leakage-audit.v1",
        "id": f"owaud_{sha256(repr(values).encode('utf-8')).hexdigest()[:16]}",
        "taskId": policy.task_id,
        "scannedAt": _now(),
        "status": "blocked" if any(item["level"] == "block" for item in findings) else ("warning" if findings else "pass"),
        "forbiddenIdentifiers": policy.forbidden_identifiers,
        "forbiddenPaths": policy.forbidden_paths,
        "findings": findings,
        "sanitizedQueries": sanitized_queries
    }


def ensure_pass(audit: dict[str, Any]) -> None:
    if audit.get("status") == "blocked":
        raise SystemExit(f"Leakage blocked OpenWorld artifact: {len(audit.get('findings', []))} finding(s)")


def _finding(id_: str, level: str, surface: str, source: str, message: str, match: str) -> dict[str, str]:
    return {"id": id_, "level": level, "surface": surface, "source": source, "message": message, "match": match[:160]}


def _now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
