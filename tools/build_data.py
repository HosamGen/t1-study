#!/usr/bin/env python3
"""Build data/u1.json, data/u2.json, data/u3.json from the public question files.

Usage:
    python tools/build_data.py --src <clone of HosamGen/t1-study-assets>

Reads u1_questions.txt, u2_questions.txt, u3_questions.txt (and images/ for pixel sizes, if present).
The question TEXT is kept verbatim; it is also split into brief / prompt / objectives for display.
No answers exist in the source files, so none can leak into the site.
"""
import argparse
import json
import re
import struct
from pathlib import Path

PARTS = {"U1": "u1_questions.txt", "U2": "u2_questions.txt", "U3": "u3_questions.txt"}

# Questions per set (S1, S2, ...), taken in sorted id order. U2 needs more work per question, so it has 8 smaller sets.
SET_SIZES = {"U1": [25] * 4, "U2": [12, 13] * 4, "U3": [25] * 4}

# U1 has no instruction page in the source file. This is a DRAFT in the style of U2/U3; review before launch.
U1_INSTRUCTIONS = """How to answer: "Which boxes show a change made for the stated priority?"

You will see two photos of the same place: BEFORE the project and AFTER it. The same numbered boxes are drawn on both photos and mark the same part of the scene (the photos may be slightly shifted). The brief describes the place and states one priority of the project.

Select every box that changed between the two photos AND whose change serves that priority. Do not select a box that did not change, or whose change serves something else. If no box qualifies, select "None of the boxes".

Example (made up):
Priority: "Make the street greener."
Box 1 (the sidewalk): new trees were planted. Select it.
Box 2 (the road): it was repaved, which does not make the street greener. Do not select it.
Box 3 (a building): it looks the same. Do not select it.
Answer: Box 1."""


def jpeg_size(path):
    """Return (width, height) of a baseline/progressive JPEG without third-party libraries."""
    with open(path, "rb") as f:
        if f.read(2) != b"\xff\xd8":
            return None
        while True:
            b = f.read(1)
            while b and b != b"\xff":
                b = f.read(1)
            while b == b"\xff":
                b = f.read(1)
            if not b:
                return None
            marker = b[0]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                continue
            (length,) = struct.unpack(">H", f.read(2))
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack(">xHH", f.read(5))
                return [w, h]
            f.seek(length - 2, 1)


def header_instructions(text):
    m = re.search(r"INSTRUCTIONS PAGE TEXT[^\n]*\n-----\n(.*?)\n-----\n", text, re.S)
    return m.group(1) if m else None


def parse_block(part, qid, body, images_dir):
    q = {"id": qid}
    q["boxes"] = [int(x) for x in re.search(r"^Boxes: (.+)$", body, re.M).group(1).split(",")]
    q["before"] = re.search(r"^Before image: (\S+)$", body, re.M).group(1)
    after = re.search(r"^After image: (\S+)$", body, re.M).group(1)
    q["after"] = None if after == "none" else after
    q["text"] = re.search(r"^TEXT:\n-----\n(.*?)\n-----$", body, re.M | re.S).group(1)

    # Split the verbatim TEXT for display: "Project brief:\n<brief>\n\n<prompt>[\nObjectives:\n<list>]"
    m = re.match(r"Project brief:\n(.*?)\n\n(.*)$", q["text"], re.S)
    assert m, f"{qid}: unexpected TEXT layout"
    q["brief"], rest = m.group(1), m.group(2)
    if part == "U2":
        pm = re.match(r"(.*?)\nObjectives:\n(.*)$", rest, re.S)
        assert pm, f"{qid}: no Objectives list"
        q["prompt"] = pm.group(1)
        q["options"] = []
        for line in pm.group(2).split("\n"):
            lm = re.match(r"([A-Z])\. (.+)$", line)
            assert lm, f"{qid}: bad objective line {line!r}"
            q["options"].append({"value": lm.group(1), "label": line})
        # The per-box option list in the block must match the objectives in the TEXT.
        listed = re.search(r"^Options for every box, in this order:\n(.*?)\nTEXT:", body, re.M | re.S).group(1)
        assert listed.split("\n") == [o["label"] for o in q["options"]], f"{qid}: option list mismatch"
    else:
        q["prompt"] = rest
        opts = re.search(r"^Answer options: (.+)$", body, re.M).group(1).split(" | ")
        expected = [f"Box {b}" for b in q["boxes"]] + (["None of the boxes"] if part == "U1" else [])
        assert opts == expected, f"{qid}: answer options {opts} != {expected}"
        if part == "U3":
            om = re.search(r"Objective for this question: (.*)$", q["brief"], re.S)
            assert om, f"{qid}: no 'Objective for this question'"

    if images_dir:
        for key in ("before", "after"):
            if q[key]:
                p = images_dir / q[key].rsplit("/", 1)[1]
                q[key + "_size"] = jpeg_size(p) if p.exists() else None
    return q


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, type=Path, help="local clone of the t1-study-assets repo")
    ap.add_argument("--out", type=Path, default=Path(__file__).resolve().parent.parent / "data")
    args = ap.parse_args()
    images_dir = args.src / "images" if (args.src / "images").is_dir() else None

    for part, fname in PARTS.items():
        raw = (args.src / fname).read_text(encoding="utf-8")
        chunks = re.split(r"^===== (h\d{3}) =====$", raw, flags=re.M)
        questions = [parse_block(part, qid, body.strip("\n"), images_dir)
                     for qid, body in zip(chunks[1::2], chunks[2::2])]
        ids = [q["id"] for q in questions]
        assert ids == sorted(ids) and len(set(ids)) == len(ids), f"{part}: ids not unique/sorted"
        sizes = SET_SIZES[part]
        assert sum(sizes) == len(ids), f"{part}: set sizes {sizes} do not add up to {len(ids)} questions"
        starts = [sum(sizes[:k]) for k in range(len(sizes))]
        batches = [ids[a:a + n] for a, n in zip(starts, sizes)]
        out = {
            "part": part,
            "n": len(questions),
            "instructions": U1_INSTRUCTIONS if part == "U1" else header_instructions(raw),
            "batches": batches,
            "questions": questions,
        }
        assert out["instructions"], f"{part}: no instructions text"
        args.out.mkdir(parents=True, exist_ok=True)
        path = args.out / f"{part.lower()}.json"
        path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        mism = [q["id"] for q in questions if q.get("after_size") and q["after_size"] != q.get("before_size")]
        print(f"{part}: {len(questions)} questions, {len(batches)} sets of {[len(b) for b in batches]}"
              f" -> {path}" + (f"  (before/after size differs: {mism})" if mism else ""))


if __name__ == "__main__":
    main()
