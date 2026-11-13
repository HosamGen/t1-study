#!/usr/bin/env python3
"""Turn saved participant files into the line format scoring/score.py reads.

Usage:
    python tools/collect.py <files or folders ...> [--out responses] [--include-preview]

Input: the JSON files the site saves (one per participant; e.g. downloaded from OSF/DataPipe or a Drive folder),
or .jsonl / .txt files with one such JSON object per line (e.g. text pasted from the "could not save" fallback).
Output: <out>/humans_U1.jsonl, humans_U2.jsonl, humans_U3.jsonl with lines
    {"annotator": ..., "id": ..., "answer": ..., "seconds": ..., "submitted_at": ...}
U1/U3 answer = sorted list of box ints ([] = "None of the boxes"); U2 answer = {"1": "A", ...}.
"""
import argparse
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path


def load_payloads(paths):
    files = []
    for p in map(Path, paths):
        files += sorted(x for x in p.rglob("*") if x.suffix in (".json", ".jsonl", ".txt")) if p.is_dir() else [p]
    for f in files:
        text = f.read_text(encoding="utf-8").strip()
        if not text:
            continue
        try:
            objs = [json.loads(text)]
        except json.JSONDecodeError:
            objs = [json.loads(line) for line in text.splitlines() if line.strip()]
        for o in objs:
            if isinstance(o, dict) and o.get("schema", "").startswith("t1-human-study/"):
                yield f, o
            else:
                print(f"skip (not a study file): {f}", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--out", type=Path, default=Path("responses"))
    ap.add_argument("--include-preview", action="store_true", help="keep test runs without a PROLIFIC_PID")
    args = ap.parse_args()

    latest = {}  # (part, annotator, id) -> (finished_at, record)
    for f, p in load_payloads(args.inputs):
        if p.get("preview") and not args.include_preview:
            print(f"skip preview run: {f}", file=sys.stderr)
            continue
        for r in p["responses"]:
            key = (p["part"], r["annotator"], r["id"])
            rec = {k: r.get(k) for k in ("annotator", "id", "answer", "seconds", "submitted_at")}
            stamp = p.get("finished_at") or ""
            if key in latest:
                print(f"duplicate answer {key}; keeping the one with the later finished_at", file=sys.stderr)
                if latest[key][0] >= stamp:
                    continue
            latest[key] = (stamp, rec)

    by_part = defaultdict(list)
    for (part, _, _), (_, rec) in sorted(latest.items()):
        by_part[part].append(rec)
    args.out.mkdir(parents=True, exist_ok=True)
    for part, recs in sorted(by_part.items()):
        path = args.out / f"humans_{part}.jsonl"
        with open(path, "w", encoding="utf-8") as fh:
            for rec in recs:
                fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        per_id = Counter(r["id"] for r in recs)
        people = len({r["annotator"] for r in recs})
        print(f"{part}: {len(recs)} answers from {people} participant(s), {len(per_id)} distinct ids "
              f"(answers per id: min {min(per_id.values())}, max {max(per_id.values())}) -> {path}")


if __name__ == "__main__":
    main()
