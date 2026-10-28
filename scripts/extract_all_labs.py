"""Extract every numeric lab result from the Epic C-CDA export into a long-format CSV.

Usage: python -I scripts/extract_all_labs.py <IHE_XDM/Joel1 dir> <output.csv>

One row per (collection date, test). Duplicates across documents are dropped.
Columns: date, group, panel, test, loinc, value, unit, censor, ref_low, ref_high, flag
    censor: '' for an exact result, '<' or '>' when the lab reported a limit
    flag:   lab interpretation code from the reference range (N, H, L, A, ...)
No names, addresses or record IDs are written.
"""
import csv
import glob
import os
import re
import sys
from datetime import datetime, timedelta
import xml.etree.ElementTree as ET

H = '{urn:hl7-org:v3}'
XSI = '{http://www.w3.org/2001/XMLSchema-instance}type'
SKIP_LOINC = {'56850-1'}  # "Lab Interpretation" text rows

# The same test is reported under different names over the years; merge them.
ALIASES = {
    'ALT (SGPT)': 'ALT', 'AST (SGOT)': 'AST', 'Alkaline Phos': 'Alkaline Phosphatase',
    'ANION': 'Anion Gap', 'Bilirubin, Tot': 'Bilirubin, Total', 'Bilirubin Total': 'Bilirubin, Total',
    'Bilirubin, Dir': 'Bilirubin, Direct', 'ANC-Automated': 'ANC', 'GFR': 'eGFR',
    'eGFR Based on CKD-EPI 2021 Equation': 'eGFR', 'eGFR based on CKD-EPI 2021 equation': 'eGFR',
    'Glyco Hgb (A1C)': 'HbA1c',
}
UNIT_FIXES = {'MCHC': 'g/dL', 'eGFR': 'mL/min/1.73m2'}  # older reports used % / mL/min

GROUPS = {
    'Thyroid': ['TSH', 'T3 Total', 'Free T4', 'Thyroxine (T4)', 'Thyroid Stimulating', 'TSH Receptor'],
    'Liver': ['ALT', 'AST', 'Alkaline Phosphatase', 'Bilirubin', 'Albumin', 'Total Protein', 'Lipase'],
    'Kidney & electrolytes': ['BUN', 'Creatinine', 'eGFR', 'Sodium', 'Potassium', 'Chloride',
                              'Bicarbonate', 'Calcium', 'Anion Gap', 'Specific Gravity', 'pH'],
    'Blood sugar': ['Glucose', 'HbA1c'],
    'Lipids': ['Cholesterol', 'HDL', 'LDL', 'Triglycerides', 'Non-HDL'],
    'Blood counts': ['WBC', 'RBC', 'Hgb', 'Hct', 'MCV', 'MCH', 'MCHC', 'RDW', 'Plt', 'MPV', 'ANC',
                     'Abs ', 'Imm Gran', 'Segs', 'Lymphocytes', 'Monocytes', 'Eosinophils', 'Basophils'],
    'Clotting': ['INR', 'PT', 'PTT'],
    'Immunity': ['Antibody'],
    'Heart': ['ATRIAL', 'Troponin', 'ProBNP', 'QT', 'QRS', 'PR INTERVAL', 'VENTRICULAR', 'AXIS'],
}


def group_of(test):
    t = test.lower()
    for group, keys in GROUPS.items():
        if any(t.startswith(k.lower()) or (len(k) >= 4 and k.lower() in t) for k in keys):
            return group
    return 'Other'


def pacific_date(value):
    """HL7 timestamp -> local Pacific date (US DST rules)."""
    m = re.match(r'(\d{8})(\d{4})?(\d{2})?([+-]\d{4})?', value)
    dt = datetime.strptime(m.group(1) + (m.group(2) or '0000'), '%Y%m%d%H%M')
    if m.group(4):
        sign = 1 if m.group(4)[0] == '+' else -1
        dt -= sign * timedelta(hours=int(m.group(4)[1:3]), minutes=int(m.group(4)[3:5]))
        y = dt.year
        mar = datetime(y, 3, 1)
        start = mar + timedelta(days=(6 - mar.weekday()) % 7 + 7, hours=10)
        nov = datetime(y, 11, 1)
        end = nov + timedelta(days=(6 - nov.weekday()) % 7, hours=9)
        dt += timedelta(hours=-7) if start <= dt < end else timedelta(hours=-8)
    return dt.date().isoformat()


def bounds(v):
    """(low, high, unit) from an IVL_PQ / IVL_REAL element; open ends are None."""
    lo = v.find(H + 'low')
    hi = v.find(H + 'high')
    def num(e):
        if e is None:
            return None
        if e.get('value') is not None:
            return float(e.get('value'))
        t = e.find(H + 'translation')  # Epic puts some limits here, with the unit as text
        return float(t.get('value')) if t is not None and t.get('value') else None

    def unit_of(e):
        if e is None:
            return ''
        if e.get('unit'):
            return e.get('unit')
        t = e.find(H + 'translation/' + H + 'originalText')
        return (t.text or '').strip() if t is not None else ''

    unit = next((unit_of(e) for e in (lo, hi) if unit_of(e)), '')
    return num(lo), num(hi), unit


def parse_result(v):
    """(value, unit, censor) or None when the result is not numeric."""
    if v is None:
        return None
    t = v.get(XSI, '')
    if t in ('PQ', 'REAL') and v.get('value') is not None:
        try:
            return float(v.get('value')), v.get('unit', ''), ''
        except ValueError:
            return None
    if t.startswith('IVL'):
        lo, hi, unit = bounds(v)
        if lo is None and hi is not None:
            return hi, unit, '<'
        if hi is None and lo is not None:
            return lo, unit, '>'
    return None


def main(doc_dir, out_path):
    rows = {}
    for path in sorted(glob.glob(os.path.join(doc_dir, 'DOC*.XML'))):
        root = ET.parse(path).getroot()
        for org in root.iter(H + 'organizer'):
            et = org.find(H + 'effectiveTime')
            low = et.find(H + 'low') if et is not None else None
            if low is None or not low.get('value'):
                continue
            date = pacific_date(low.get('value'))
            oc = org.find(H + 'code')
            ot = oc.find(H + 'originalText') if oc is not None else None
            panel = (ot.text or '').strip() if ot is not None else ''
            for obs in org.iter(H + 'observation'):
                c = obs.find(H + 'code')
                if c is None or c.get('code') in SKIP_LOINC or c.get('codeSystemName') == 'SNOMED CT':
                    continue
                cot = c.find(H + 'originalText')
                test = ((cot.text or '').strip() if cot is not None else '') or c.get('displayName', '')
                res = parse_result(obs.find(H + 'value'))
                if not test or res is None:
                    continue
                test = ALIASES.get(test, test)
                value, unit, censor = res
                rr = obs.find(H + 'referenceRange/' + H + 'observationRange')
                ref_low = ref_high = None
                flag = ''
                if rr is not None:
                    rv = rr.find(H + 'value')
                    if rv is not None and rv.get(XSI, '').startswith('IVL'):
                        ref_low, ref_high, u2 = bounds(rv)
                        unit = unit or u2
                    ic = rr.find(H + 'interpretationCode')
                    flag = ic.get('code', '') if ic is not None else ''
                unit = UNIT_FIXES.get(test, unit)
                rows[(date, test, value, censor)] = {
                    'date': date, 'group': group_of(test), 'panel': panel, 'test': test,
                    'loinc': c.get('code') or '',
                    'value': value, 'unit': unit, 'censor': censor,
                    'ref_low': '' if ref_low is None else ref_low,
                    'ref_high': '' if ref_high is None else ref_high, 'flag': flag,
                }
    out = sorted(rows.values(), key=lambda r: (r['date'], r['test']))
    with open(out_path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(out[0]))
        w.writeheader()
        w.writerows(out)
    print(f'wrote {len(out)} results, {len({r["test"] for r in out})} distinct tests, '
          f'{len({r["date"] for r in out})} dates to {out_path}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
