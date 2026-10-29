"""Convert personal_thyroid.csv into JSON for the D3 linked-panel timeline.

Dose convention: each row's methimazole_mg is the dose being taken at the time
of that draw. Dose changes were made in response to a draw, so the dose in row i
started at draw i-1.
"""
import csv
import json
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "personal_thyroid.csv"
OUT = ROOT / "data" / "processed" / "personal.json"

LABS = ["TSH", "FT4", "T3", "TT4", "TSI", "TRAb"]
# personal_thyroid.csv stores T3 in nmol/L (Kaggle units); the lab reports ng/mL.
T3_NMOL_PER_NGML = 1.536


def parse_date(text):
    """Accept ISO dates and the M/D/YYYY format Excel writes when it saves the CSV."""
    for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            pass
    raise ValueError(f"Unrecognized date: {text!r}")


def merge_spans(spans, key):
    """Join adjacent spans that have the same value for key."""
    merged = []
    for s in spans:
        if merged and merged[-1][key] == s[key]:
            merged[-1]["end"] = s["end"]
        else:
            merged.append(dict(s))
    return merged


def main():
    with SRC.open(newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        r["date"] = parse_date(r["date"]).isoformat()
    rows.sort(key=lambda r: r["date"])

    draws = [
        {
            "id": i,
            "date": r["date"],
            "status": r["lab_status"],
            "dose_mg": float(r["methimazole_mg"]),
        }
        for i, r in enumerate(rows)
    ]

    labs = []
    for d, r in zip(draws, rows):
        for lab in LABS:
            if r[lab] == "":
                continue
            value = float(r[lab])
            if lab == "T3":
                value = round(value / T3_NMOL_PER_NGML, 1)
            labs.append({
                "draw_id": d["id"],
                "date": d["date"],
                "lab": lab,
                "value": value,
            })

    # Dose taken at draw i began at draw i-1. The first draw has no earlier
    # draw, so its span is a single point. The dose after the last draw isn't
    # recorded, so the final span is open-ended with an unknown dose.
    dose_spans = [{"start": draws[0]["date"], "end": draws[0]["date"],
                   "dose_mg": draws[0]["dose_mg"]}]
    for prev, cur in zip(draws, draws[1:]):
        dose_spans.append({"start": prev["date"], "end": cur["date"],
                           "dose_mg": cur["dose_mg"]})
    dose_spans = merge_spans(dose_spans, "dose_mg")
    dose_spans.append({"start": draws[-1]["date"], "end": None, "dose_mg": None})

    # A status holds from its draw until the next one.
    status_spans = [
        {"start": cur["date"], "end": nxt["date"] if nxt else None,
         "status": cur["status"]}
        for cur, nxt in zip(draws, draws[1:] + [None])
    ]
    status_spans = merge_spans(status_spans, "status")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "draws": draws,
        "labs": labs,
        "dose_spans": dose_spans,
        "status_spans": status_spans,
    }, indent=2))
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(draws)} draws, {len(labs)} lab values, "
          f"{len(dose_spans)} dose spans, {len(status_spans)} status spans")


if __name__ == "__main__":
    main()
