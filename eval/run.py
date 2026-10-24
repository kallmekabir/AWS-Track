#!/usr/bin/env python3
"""CareCall ranking eval. Spec: docs/RANKING.md.

Runs each case transcript through the real call path:
  app.understand.extract_facts(transcript, said_emergency=lex_hook.is_emergency(...))
then app.rules.rank_after_call(facts, resident, drive_minutes), and compares the
rule id to the expected one.

Headline metric: missed_help_now (expected HELP_NOW level, got anything else). Target 0.
Exits 1 if missed_help_now > 0.

Run live:
  cd backend && AWS_PROFILE=carecall AWS_DEFAULT_REGION=us-east-1 \
    BEDROCK_MODEL_ID=us.amazon.nova-lite-v1:0 .venv/bin/python ../eval/run.py

Flags:
  --only <id>   run one case
  --offline     skip Bedrock; use each case's "facts" field (rules-only test)
"""
import argparse
import json
import os
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

# Make `app` and `lambdas` importable from backend/ regardless of CWD.
BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))

import yaml  # noqa: E402

from app.understand import Facts, Extraction, extract_facts  # noqa: E402
from app import rules as rules_mod  # noqa: E402
from lambdas.lex_hook import is_emergency, QUESTIONS  # noqa: E402

CASES_FILE = Path(__file__).resolve().parent / "cases.yaml"
REPORT_FILE = Path(__file__).resolve().parent / "report.json"

# Which rule ids map to the HELP_NOW level (for the headline metric).
HELP_NOW_RULES = {"R0", "R1", "R2"}
# Level severity order (lower = more urgent), from docs/RANKING.md dashboard order.
LEVEL_ORDER = {
    "HELP_NOW": 0, "HELP_SOON": 1, "PERSON_CHECK": 2,
    "NEEDS_SUPPLIES": 3, "OK_FOR_NOW": 4,
}


def load_cases():
    with open(CASES_FILE) as f:
        return yaml.safe_load(f)


def resident_of(case):
    return SimpleNamespace(
        device_group=case.get("device_group", 3),
        backup_hours_each=case.get("backup_hours_each"),
    )


def facts_from_case(case):
    """Build a Facts object from a case's offline `facts` field.

    YAML turns bare yes/no into booleans; the enum fields safe/device_working
    need the strings back.
    """
    raw = dict(case["facts"])
    for field in ("safe", "device_working"):
        v = raw.get(field)
        if v is True:
            raw[field] = "yes"
        elif v is False:
            raw[field] = "no"
    return Facts.model_validate(raw)


def run_case(case, offline):
    """Return a per-case result dict."""
    cid = case["id"]
    expected = case["expected"]
    drive = case.get("drive_minutes")
    resident = resident_of(case)

    # Case 10 style: no answer twice -> no_answer_decision, no Bedrock.
    if case.get("no_answer"):
        dec = rules_mod.no_answer_decision(int(case["no_answer"]))
        return {
            "id": cid, "expected": expected, "got": dec.rule_id,
            "level": dec.level.value, "reason": dec.reason,
            "latency_ms": 0, "ok": True, "problems": [], "mode": "no_answer",
        }

    answers = case.get("answers", [])
    said_emergency = any(is_emergency(a or "") for a in answers)
    # Build the transcript the way the live path does: list of {question, answer}.
    transcript = [{"question": QUESTIONS[i + 1], "answer": a}
                  for i, a in enumerate(answers)]

    if offline:
        facts = facts_from_case(case)
        # offline still honors the script emergency check (Bedrock can add, never remove)
        if said_emergency and not facts.emergency:
            facts = facts.model_copy(update={"emergency": True})
        ext = Extraction(facts=facts, model_id="offline", latency_ms=0, ok=True,
                         problems=[], transcript="offline")
    else:
        ext = extract_facts(transcript, said_emergency=said_emergency)

    dec = rules_mod.rank_after_call(ext.facts, resident, drive)
    return {
        "id": cid, "expected": expected, "got": dec.rule_id,
        "level": dec.level.value, "reason": dec.reason,
        "latency_ms": ext.latency_ms, "ok": ext.ok, "problems": ext.problems,
        "mode": "offline" if offline else "live",
    }


def summarize(results):
    exact = sum(1 for r in results if r["got"] == r["expected"])
    missed_help_now = 0
    under = 0
    over = 0
    for r in results:
        exp_level = _rule_level(r["expected"])
        got_level = LEVEL_ORDER.get(r["level"])
        if exp_level is None or got_level is None:
            continue
        if r["expected"] in HELP_NOW_RULES and got_level != LEVEL_ORDER["HELP_NOW"]:
            missed_help_now += 1
        if got_level > exp_level:
            under += 1       # less urgent than expected
        elif got_level < exp_level:
            over += 1        # more urgent than expected
    latencies = [r["latency_ms"] for r in results if r.get("latency_ms")]
    failures = [r["id"] for r in results if not r["ok"]]
    return {
        "total": len(results),
        "exact_rule_matches": exact,
        "missed_help_now": missed_help_now,
        "under_escalated": under,
        "over_escalated": over,
        "median_latency_ms": int(statistics.median(latencies)) if latencies else 0,
        "max_latency_ms": max(latencies) if latencies else 0,
        "extraction_failures": failures,
    }


def _rule_level(rule_id):
    """Map an expected rule id to its level order, per docs/RANKING.md."""
    mapping = {
        "R0": "HELP_NOW", "R1": "HELP_NOW", "R2": "HELP_NOW",
        "R3": "HELP_SOON", "NA": "HELP_SOON",
        "R4": "PERSON_CHECK", "R5": "NEEDS_SUPPLIES", "R6": "OK_FOR_NOW",
    }
    return LEVEL_ORDER.get(mapping.get(rule_id))


def print_table(results):
    hdr = f"{'id':<16} {'exp':<4} {'got':<4} {'level':<15} {'lat(ms)':>8}  reason"
    print(hdr)
    print("-" * len(hdr))
    for r in results:
        flag = " " if r["got"] == r["expected"] else "x"
        print(f"{flag}{r['id']:<15} {r['expected']:<4} {r['got']:<4} "
              f"{r['level']:<15} {r['latency_ms']:>8}  {r['reason']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="run one case by id")
    ap.add_argument("--offline", action="store_true", help="skip Bedrock; use case facts")
    args = ap.parse_args()

    cases = load_cases()
    if args.only:
        cases = [c for c in cases if c["id"] == args.only]
        if not cases:
            print(f"No case with id {args.only}", file=sys.stderr)
            return 2

    model_id = "offline" if args.offline else os.getenv("BEDROCK_MODEL_ID", "")
    if not args.offline and not model_id:
        print("BEDROCK_MODEL_ID not set (use --offline for a rules-only run).", file=sys.stderr)
        return 2

    results = [run_case(c, args.offline) for c in cases]
    print_table(results)
    summary = summarize(results)
    print("\nSummary:")
    for k, v in summary.items():
        print(f"  {k}: {v}")

    report = {
        "model_id": model_id,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "offline": args.offline,
        "cases": results,
        "summary": summary,
    }
    with open(REPORT_FILE, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\nWrote {REPORT_FILE}")

    if summary["missed_help_now"] > 0:
        print(f"\nFAIL: missed_help_now = {summary['missed_help_now']} (target 0)", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
