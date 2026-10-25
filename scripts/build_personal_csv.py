"""Build a thyroidDF.csv-style CSV from an Epic/MyChart C-CDA health summary export.

Usage:
    python -I scripts/build_personal_csv.py <IHE_XDM/Joel1 dir> <output.csv>

One row per lab draw (local collection date). Columns match thyroidDF.csv, with
values converted to the Kaggle units, followed by a few extra columns that have
no equivalent in the Kaggle data (date, Free T4, TSI, TRAb, methimazole dose).

Unit notes (Kaggle thyroid0387 conventions):
    TSH  mU/L   == uIU/mL                (no conversion)
    T3   nmol/L <- ng/mL * 1.536         (total T3, MW 651 g/mol)
    TT4  nmol/L <- ug/dL * 12.87         (total T4, MW 777 g/mol)
Values reported as "<0.01" are stored as the detection limit (0.01).
"""
import csv
import glob
import os
import re
import sys
from datetime import date, datetime, timedelta
import xml.etree.ElementTree as ET

H = '{urn:hl7-org:v3}'
XSI_TYPE = '{http://www.w3.org/2001/XMLSchema-instance}type'

BIRTH_DATE = date(1986, 6, 28)
SEX = 'M'

# LOINC code -> (column, multiplier to Kaggle units)
LOINC = {
    '11580-8': ('TSH', 1.0),
    '3053-6': ('T3', 1.536),
    '3026-2': ('TT4', 12.87),
    '3024-7': ('FT4', 1.0),
    '30567-2': ('TSI', 1.0),
    '5385-0': ('TRAb', 1.0),
}

# Upper/lower reference limits from the UCSD lab reports (original units)
REF = {'TSH': (0.27, 4.20), 'FT4': (0.93, 1.70), 'T3_ngml': (0.8, 2.0)}

KAGGLE_COLS = [
    'age', 'sex', 'on_thyroxine', 'query_on_thyroxine', 'on_antithyroid_meds', 'sick',
    'pregnant', 'thyroid_surgery', 'I131_treatment', 'query_hypothyroid',
    'query_hyperthyroid', 'lithium', 'goitre', 'tumor', 'hypopituitary', 'psych',
    'TSH_measured', 'TSH', 'T3_measured', 'T3', 'TT4_measured', 'TT4', 'T4U_measured',
    'T4U', 'FTI_measured', 'FTI', 'TBG_measured', 'TBG', 'referral_source', 'target',
    'patient_id',
]
EXTRA_COLS = ['date', 'FT4', 'TSI', 'TRAb', 'methimazole_mg', 'lab_status']


def us_pacific_offset(dt_utc):
    """UTC offset for America/Los_Angeles (US DST rules since 2007)."""
    y = dt_utc.year
    march1 = datetime(y, 3, 1)
    dst_start = march1 + timedelta(days=(6 - march1.weekday()) % 7 + 7, hours=10)  # 2nd Sun 2am PST
    nov1 = datetime(y, 11, 1)
    dst_end = nov1 + timedelta(days=(6 - nov1.weekday()) % 7, hours=9)  # 1st Sun 2am PDT
    return timedelta(hours=-7) if dst_start <= dt_utc < dst_end else timedelta(hours=-8)


def parse_ts(value):
    """HL7 timestamp ('20240321151600+0000' or '20240321') -> local Pacific date."""
    m = re.match(r'(\d{8})(\d{4,6})?([+-]\d{4})?', value)
    dt = datetime.strptime(m.group(1) + (m.group(2) or '0000')[:4], '%Y%m%d%H%M')
    if m.group(3):
        sign = 1 if m.group(3)[0] == '+' else -1
        off = timedelta(hours=int(m.group(3)[1:3]), minutes=int(m.group(3)[3:5])) * sign
        utc = dt - off
        dt = utc + us_pacific_offset(utc)
    return dt.date()


def parse_value(v):
    """Numeric result from a PQ/REAL/IVL_REAL value element (censored -> limit)."""
    if v is None:
        return None
    if v.get('value') is not None:
        return float(v.get('value'))
    if v.get(XSI_TYPE, '').startswith('IVL'):
        for bound in ('high', 'low'):
            b = v.find(H + bound)
            if b is not None and b.get('value') is not None:
                return float(b.get('value'))
    return None


def extract(doc_dir):
    labs = {}   # (date, column) -> value
    meds = {}   # (start, end) -> mg/day
    for path in sorted(glob.glob(os.path.join(doc_dir, 'DOC*.XML'))):
        root = ET.parse(path).getroot()

        for org in root.iter(H + 'organizer'):
            et = org.find(H + 'effectiveTime')
            low = et.find(H + 'low') if et is not None else None
            if low is None or low.get('value') is None:
                continue
            drawn = parse_ts(low.get('value'))
            for obs in org.iter(H + 'observation'):
                code = obs.find(H + 'code')
                if code is None or code.get('code') not in LOINC:
                    continue
                col, mult = LOINC[code.get('code')]
                val = parse_value(obs.find(H + 'value'))
                if val is not None:
                    labs[(drawn, col)] = round(val * mult, 2)

        refs = {e.get('ID'): ''.join(e.itertext()) for e in root.iter() if e.get('ID')}
        for sa in root.iter(H + 'substanceAdministration'):
            ref = sa.find('.//' + H + 'manufacturedMaterial/' + H + 'code/'
                          + H + 'originalText/' + H + 'reference')
            if ref is None or 'methimazole' not in refs.get(ref.get('value', '')[1:], '').lower():
                continue
            et = sa.find(H + 'effectiveTime')
            dose = sa.find(H + 'doseQuantity')
            low = et.find(H + 'low') if et is not None else None
            high = et.find(H + 'high') if et is not None else None
            if low is None or dose is None:
                continue
            start = parse_ts(low.get('value'))
            end = parse_ts(high.get('value')) if high is not None and high.get('value') else None
            meds[(start, end)] = float(dose.get('value'))
    return labs, meds


def dose_on(day, meds):
    best = None
    for (start, end), mg in meds.items():
        if start <= day and (end is None or day < end):
            if best is None or start > best[0]:
                best = (start, mg)
    return best[1] if best else 0.0


def lab_status(r):
    tsh, ft4, t3 = r.get('TSH'), r.get('FT4'), r.get('T3')
    t3_ngml = t3 / 1.536 if t3 is not None else None
    high_hormone = (ft4 is not None and ft4 > REF['FT4'][1]) or \
                   (t3_ngml is not None and t3_ngml > REF['T3_ngml'][1]) or \
                   (r.get('TT4') is not None and r['TT4'] > 10.9 * 12.87)
    low_hormone = (ft4 is not None and ft4 < REF['FT4'][0]) or \
                  (t3_ngml is not None and t3_ngml < REF['T3_ngml'][0])
    if high_hormone:
        return 'hyperthyroid'
    if tsh is not None and tsh < REF['TSH'][0]:
        return 'subclinical_hyper' if not low_hormone else 'low_tsh_low_hormone'
    if low_hormone or (tsh is not None and tsh > REF['TSH'][1]):
        return 'hypothyroid'
    if tsh is None and ft4 is None and t3 is None:
        return ''
    return 'euthyroid'


def fmt(x):
    return '' if x is None else ('%g' % x)


def main(doc_dir, out_path):
    labs, meds = extract(doc_dir)
    days = sorted({d for d, col in labs if col in ('TSH', 'T3', 'TT4', 'FT4', 'TSI', 'TRAb')})
    rows = []
    for day in days:
        r = {col: labs.get((day, col)) for col, _ in LOINC.values()}
        mg = dose_on(day, meds)
        age = day.year - BIRTH_DATE.year - ((day.month, day.day) < (BIRTH_DATE.month, BIRTH_DATE.day))
        row = dict.fromkeys(KAGGLE_COLS, 'f')
        row.update({
            'age': age, 'sex': SEX,
            'on_antithyroid_meds': 't' if mg > 0 else 'f',
            'query_hyperthyroid': 't',
            'T4U': '', 'FTI': '', 'TBG': '',
            'referral_source': 'other',
            # Kaggle codes: A = hyperthyroid, O = antithyroid drug treatment
            'target': 'O' if mg > 0 else 'A',
            'patient_id': 'self',
        })
        for col in ('TSH', 'T3', 'TT4'):
            row[col] = fmt(r[col])
            row[col + '_measured'] = 't' if r[col] is not None else 'f'
        row.update({
            'date': day.isoformat(), 'FT4': fmt(r['FT4']), 'TSI': fmt(r['TSI']),
            'TRAb': fmt(r['TRAb']), 'methimazole_mg': fmt(mg), 'lab_status': lab_status(r),
        })
        rows.append(row)

    with open(out_path, 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=KAGGLE_COLS + EXTRA_COLS)
        w.writeheader()
        w.writerows(rows)
    print(f'wrote {len(rows)} rows to {out_path}')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
