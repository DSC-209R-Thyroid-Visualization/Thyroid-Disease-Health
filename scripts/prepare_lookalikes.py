"""For each personal draw, find the 50 Kaggle patients with the closest TSH and T3 and
record what share of them were diagnosed hyper, normal or hypo.

Ported from pnidadavolu/lookalikes_prototype.ipynb so the D3 page can show it without
loading the Kaggle CSV. Distance is Euclidean on [log10 TSH, T3], each scaled by its
standard deviation across the Kaggle patients.
"""
import csv
import json
import math
from datetime import datetime
from pathlib import Path
from statistics import pstdev

ROOT = Path(__file__).resolve().parent.parent
KAGGLE = ROOT / "data" / "thyroidDF.csv"
PERSONAL = ROOT / "data" / "personal_thyroid.csv"
OUT = ROOT / "data" / "processed" / "lookalikes.json"

K = 50
GROUPS = ["hyper", "normal", "hypo"]
GROUP_BY_CODE = {**{c: "hyper" for c in "ABCD"}, **{c: "hypo" for c in "EFGH"}, "-": "normal"}
# Kaggle reports TSH down to 0.005; clip so log10 is defined.
TSH_MIN = 0.005


def parse_date(text):
    for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Unrecognized date: {text!r}")


def load_kaggle():
    patients = []
    with KAGGLE.open(newline="") as f:
        for r in csv.DictReader(f):
            group = GROUP_BY_CODE.get(r["target"][:1])
            if not group or r["TSH"] == "" or r["T3"] == "" or float(r["age"]) > 100:
                continue
            patients.append((math.log10(max(float(r["TSH"]), TSH_MIN)), float(r["T3"]), group))
    return patients


def main():
    patients = load_kaggle()
    scale = [pstdev(p[0] for p in patients), pstdev(p[1] for p in patients)]

    with PERSONAL.open(newline="") as f:
        rows = sorted(csv.DictReader(f), key=lambda r: parse_date(r["date"]))

    out = []
    for r in rows:
        # T3 is in nmol/L here, the same units as Kaggle. Draws without T3 are skipped.
        if r["TSH"] == "" or r["T3"] == "":
            continue
        q = (math.log10(max(float(r["TSH"]), TSH_MIN)), float(r["T3"]))
        dist = [((p[0] - q[0]) / scale[0]) ** 2 + ((p[1] - q[1]) / scale[1]) ** 2 for p in patients]
        nearest = sorted(range(len(patients)), key=lambda i: dist[i])[:K]
        counts = {g: 0 for g in GROUPS}
        for i in nearest:
            counts[patients[i][2]] += 1
        out.append({"date": parse_date(r["date"]).isoformat(), **{g: counts[g] / K for g in GROUPS}})

    OUT.write_text(json.dumps({"k": K, "draws": out}, indent=2) + "\n")
    print(f"{len(out)} draws ({len(patients)} Kaggle patients) -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
