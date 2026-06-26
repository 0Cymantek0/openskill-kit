from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .leakage import LeakagePolicy, audit_values, ensure_pass, sanitize_query
from .schemas import OpenWorldTask, placeholder_anchor, placeholder_run, placeholder_skill_plan, placeholder_source, placeholder_suite


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="openskillkit-evolution")
    parser.add_argument("--project-root", default=".", help="Project root")
    sub = parser.add_subparsers(dest="command", required=True)

    plan = sub.add_parser("plan-task")
    plan.add_argument("--title", required=True)
    plan.add_argument("--prompt", required=True)
    plan.add_argument("--task-type", default="general")
    plan.add_argument("--allow-web", action="store_true")
    _policy_args(plan)

    research = sub.add_parser("research")
    research.add_argument("--task-id", required=True)
    research.add_argument("--query", required=True)
    _policy_args(research)

    anchors = sub.add_parser("anchors")
    anchors.add_argument("--task-id", required=True)
    anchors.add_argument("--claim", default="OpenWorld scaffold must pass leakage audit before promotion.")
    _policy_args(anchors)

    verifier = sub.add_parser("build-verifier")
    verifier.add_argument("--task-id", required=True)
    verifier.add_argument("--anchor-id", required=True)
    _policy_args(verifier)

    evolve = sub.add_parser("evolve")
    evolve.add_argument("--task-id", required=True)
    evolve.add_argument("--anchor-id", required=True)
    evolve.add_argument("--suite-id", required=True)
    evolve.add_argument("--plan-id", required=True)
    _policy_args(evolve)

    args = parser.parse_args(argv)
    root = Path(args.project_root).resolve()
    if args.command == "plan-task":
        result = command_plan_task(root, args)
    elif args.command == "research":
        result = command_research(root, args)
    elif args.command == "anchors":
        result = command_anchors(root, args)
    elif args.command == "build-verifier":
        result = command_build_verifier(root, args)
    elif args.command == "evolve":
        result = command_evolve(root, args)
    else:
        raise SystemExit(f"Unknown command: {args.command}")
    print(json.dumps(result, indent=2))


def command_plan_task(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    task = OpenWorldTask(
        title=args.title,
        prompt=args.prompt,
        forbidden_identifiers=args.forbidden_identifier,
        forbidden_paths=args.forbidden_path,
        task_type=args.task_type,
        allow_web=args.allow_web,
    ).to_json()
    policy = _policy(task["id"], args)
    audit = audit_values([("prompt", "content", args.prompt), ("title", "content", args.title)], policy)
    ensure_pass(audit)
    task_path = _write_json(_task_dir(root, task["id"]) / "task.json", task, root)
    audit_path = _write_json(_task_dir(root, task["id"]) / "audits" / f"{audit['id']}.json", audit, root)
    return {"schemaVersion": "openskill-kit.python-result.v1", "command": "plan-task", "task": task, "paths": {"task": str(task_path), "audit": str(audit_path)}, "audit": audit}


def command_research(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    policy = _policy(args.task_id, args)
    sanitized = sanitize_query(args.query, policy)
    audit = audit_values([("query", "query", args.query), ("sanitized-query", "query", sanitized)], policy)
    ensure_pass({"status": "pass" if sanitized else audit["status"], "findings": []})
    content = f"Placeholder local research query: {sanitized}"
    source = placeholder_source(args.task_id, content)
    source["leakageAuditId"] = audit["id"]
    source_path = _write_json(_task_dir(root, args.task_id) / "sources" / f"{source['id']}.json", source, root)
    audit_path = _write_json(_task_dir(root, args.task_id) / "audits" / f"{audit['id']}.json", audit, root)
    return {"schemaVersion": "openskill-kit.python-result.v1", "command": "research", "query": sanitized, "source": source, "paths": {"source": str(source_path), "audit": str(audit_path)}, "audit": audit}


def command_anchors(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    policy = _policy(args.task_id, args)
    audit = audit_values([("claim", "content", args.claim)], policy)
    ensure_pass(audit)
    anchor = placeholder_anchor(args.task_id, "src_placeholder", args.claim)
    anchor_path = _write_json(_task_dir(root, args.task_id) / "anchors" / f"{anchor['id']}.json", anchor, root)
    audit_path = _write_json(_task_dir(root, args.task_id) / "audits" / f"{audit['id']}.json", audit, root)
    return {"schemaVersion": "openskill-kit.python-result.v1", "command": "anchors", "anchor": anchor, "paths": {"anchor": str(anchor_path), "audit": str(audit_path)}, "audit": audit}


def command_build_verifier(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    policy = _policy(args.task_id, args)
    audit = audit_values([("anchor-id", "content", args.anchor_id)], policy)
    ensure_pass(audit)
    suite = placeholder_suite(args.task_id, args.anchor_id)
    suite["leakageAuditId"] = audit["id"]
    plan = placeholder_skill_plan(args.task_id, args.anchor_id)
    suite_path = _write_json(_task_dir(root, args.task_id) / "verifiers" / f"{suite['id']}.json", suite, root)
    plan_path = _write_json(_task_dir(root, args.task_id) / "plans" / f"{plan['id']}.json", plan, root)
    audit_path = _write_json(_task_dir(root, args.task_id) / "audits" / f"{audit['id']}.json", audit, root)
    return {"schemaVersion": "openskill-kit.python-result.v1", "command": "build-verifier", "suite": suite, "plan": plan, "paths": {"suite": str(suite_path), "plan": str(plan_path), "audit": str(audit_path)}, "audit": audit}


def command_evolve(root: Path, args: argparse.Namespace) -> dict[str, Any]:
    policy = _policy(args.task_id, args)
    audit = audit_values([("anchor-id", "content", args.anchor_id), ("suite-id", "content", args.suite_id), ("plan-id", "content", args.plan_id)], policy)
    ensure_pass(audit)
    run = placeholder_run(args.task_id, args.anchor_id, args.suite_id, args.plan_id, audit["id"])
    run_path = _write_json(root / ".openskill-kit" / "evolution" / "runs" / run["id"] / "run.json", run, root)
    audit_path = _write_json(_task_dir(root, args.task_id) / "audits" / f"{audit['id']}.json", audit, root)
    return {"schemaVersion": "openskill-kit.python-result.v1", "command": "evolve", "run": run, "paths": {"run": str(run_path), "audit": str(audit_path)}, "audit": audit}


def _policy_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--forbidden-identifier", action="append", default=[])
    parser.add_argument("--forbidden-path", action="append", default=[])


def _policy(task_id: str, args: argparse.Namespace) -> LeakagePolicy:
    return LeakagePolicy(task_id=task_id, forbidden_identifiers=args.forbidden_identifier, forbidden_paths=args.forbidden_path)


def _task_dir(root: Path, task_id: str) -> Path:
    return root / ".openskill-kit" / "openworld" / "tasks" / task_id


def _write_json(path: Path, value: dict[str, Any], root: Path) -> Path:
    resolved = path.resolve()
    allowed = [(root / ".openskill-kit" / "openworld").resolve(), (root / ".openskill-kit" / "evolution").resolve()]
    if not any(resolved == base or base in resolved.parents for base in allowed):
        raise SystemExit(f"OpenWorld artifact path outside allowed state: {resolved}")
    resolved.parent.mkdir(parents=True, exist_ok=True)
    resolved.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
    return resolved


if __name__ == "__main__":
    main()
