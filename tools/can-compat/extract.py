#!/usr/bin/env python3
"""CAN compatibility dataset extractor — Teltonika supported-vehicles XLSX → site JSON.

Dev tooling only (no runtime dependency, hard rule 10): stdlib zipfile + ElementTree.

Two source formats exist and both are handled:

  A) FMX150-style ("Supported Vehicles" sheet): one sheet, columns
     No | Category | Manufacturer | Model | Model year | Fuel type | Region | CAN Lines
     followed by parameter columns marked ① (CAN line 1), ② (line 2), ①*/②* (experimental).
     Row 0 marks where "Standard parameters" end and "Extended parameters" begin.

  B) LV-CAN200 / ALL-CAN300 "(4P) List": one sheet PER CATEGORY (Cars, Trucks, ...),
     columns NO | Brand | Model | year | <CAN buses> | parameter columns marked "+".

Output JSON shape (shared by the site page):
  { device, models[], adapterNote?, updated, source, params[{n,g}], vehicles[] }
  vehicle: { c: category, b: brand, m: model, y: years, f?: fuel, r?: region,
             l?: CAN lines, p: { paramIndex: 1|2|3 } }   (3 = experimental)

Usage: python3 tools/can-compat/extract.py   (writes apps/site/public/can/*.json)
"""
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'apps', 'site', 'public', 'can')


def col_of(ref):
    s = ''.join(c for c in ref if c.isalpha())
    n = 0
    for ch in s:
        n = n * 26 + ord(ch) - 64
    return n


def load_book(path):
    z = zipfile.ZipFile(path)
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        root = ET.fromstring(z.read('xl/sharedStrings.xml'))
        ss = [''.join(t.text or '' for t in si.iter(NS + 't')) for si in root.findall(NS + 'si')]
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    # sheet order in workbook.xml == r:id order == sheetN.xml numbering is NOT guaranteed;
    # resolve via workbook.xml.rels
    rels = ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))
    RNS = '{http://schemas.openxmlformats.org/package/2006/relationships}'
    rid_to_target = {r.get('Id'): r.get('Target') for r in rels.findall(RNS + 'Relationship')}
    RIDNS = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
    sheets = []
    for sh in wb.iter(NS + 'sheet'):
        target = rid_to_target.get(sh.get(RIDNS + 'id'), '')
        if target and not target.startswith('xl/'):
            target = 'xl/' + target
        sheets.append((sh.get('name'), target))
    return z, ss, sheets


def rows_of(z, ss, target):
    tree = ET.fromstring(z.read(target))
    out = []
    for row in tree.iter(NS + 'row'):
        cells = {}
        for c in row.iter(NS + 'c'):
            v = c.find(NS + 'v')
            if v is None or v.text is None:
                # inline strings
                is_el = c.find(NS + 'is')
                if is_el is not None:
                    cells[col_of(c.get('r'))] = ''.join(t.text or '' for t in is_el.iter(NS + 't'))
                continue
            val = ss[int(v.text)] if c.get('t') == 's' else v.text
            cells[col_of(c.get('r'))] = val
        out.append(cells)
    return out


def mark_value(raw):
    """①/②/①*/②*/+ → 1|2|3 (3 = experimental), None for anything else."""
    raw = (raw or '').strip()
    if not raw:
        return None
    if '*' in raw:
        return 3
    if raw.startswith('②'):
        return 2
    if raw.startswith('①') or raw == '+':
        return 1
    return None


def extract_fmx150(path, meta):
    z, ss, sheets = load_book(path)
    target = dict(sheets).get('Supported Vehicles') or sheets[0][1]
    rows = rows_of(z, ss, target)
    banner, hdr = rows[0], rows[2]
    ext_start = min((c for c, v in banner.items() if 'Extended' in str(v)), default=10 ** 9)
    maxcol = max(hdr)
    params = []
    colmap = {}
    for c in range(9, maxcol + 1):
        name = str(hdr.get(c, '')).strip()
        if not name:
            continue
        colmap[c] = len(params)
        params.append({'n': name, 'g': 'extended' if c >= ext_start else 'standard'})
    vehicles = []
    for r in rows[3:]:
        if 3 not in r or 4 not in r:
            continue
        p = {}
        for c, idx in colmap.items():
            m = mark_value(str(r.get(c, '')))
            if m is not None:
                p[str(idx)] = m
        vehicles.append({
            'c': str(r.get(2, '')).strip(),
            'b': str(r.get(3, '')).strip(),
            'm': str(r.get(4, '')).strip(),
            'y': str(r.get(5, '')).strip(),
            'f': str(r.get(6, '')).strip(),
            'r': str(r.get(7, '')).strip(),
            'l': str(r.get(8, '')).strip(),
            'p': p,
        })
    return {**meta, 'params': params, 'vehicles': vehicles}


def extract_4p(path, meta):
    """LV-CAN200 / ALL-CAN300 (4P) list: one sheet per category, '+' marks.

    Sheets share most parameter names; the union is built in first-seen order and each
    sheet maps its own columns into it, so a parameter present only on Trucks still lands
    in the same params[] list.
    """
    z, ss, sheets = load_book(path)
    params = []
    pindex = {}
    vehicles = []
    for name, target in sheets:
        if not target:
            continue
        rows = rows_of(z, ss, target)
        if not rows:
            continue
        hdr = rows[0]
        if not any('Brand' in str(v) for v in hdr.values()):
            continue  # legend/notes sheet
        cols = sorted(hdr)
        # fixed prefix: NO, Brand, Model, year, [buses]; param columns follow
        named = {c: str(hdr[c]).strip() for c in cols if str(hdr[c]).strip()}
        brand_c = next(c for c, v in named.items() if v == 'Brand')
        model_c = next(c for c, v in named.items() if v == 'Model')
        year_c = next((c for c, v in named.items() if v.lower() == 'year'), model_c + 1)
        buses_c = next((c for c, v in named.items() if 'CAN BUS' in v.upper()), None)
        first_param_c = (buses_c if buses_c is not None else year_c) + 1
        colmap = {}
        for c in cols:
            if c < first_param_c:
                continue
            pname = named.get(c, '')
            if not pname:
                continue
            if pname not in pindex:
                pindex[pname] = len(params)
                params.append({'n': pname, 'g': 'standard'})
            colmap[c] = pindex[pname]
        for r in rows[1:]:
            if brand_c not in r or model_c not in r:
                continue
            brand = str(r[brand_c]).strip()
            model = str(r[model_c]).strip()
            if not brand or not model:
                continue
            p = {}
            for c, idx in colmap.items():
                m = mark_value(str(r.get(c, '')))
                if m is not None:
                    p[str(idx)] = m
            vehicles.append({
                'c': name,
                'b': brand,
                'm': model,
                'y': str(r.get(year_c, '')).strip(),
                'l': str(r.get(buses_c, '')).strip() if buses_c is not None else '',
                'p': p,
            })
    return {**meta, 'params': params, 'vehicles': vehicles}


def main():
    os.makedirs(OUT, exist_ok=True)
    data_dir = os.path.join(HERE, 'data')
    jobs = [
        ('fmx150.json', extract_fmx150, os.path.join(data_dir, 'fmx150.xlsx'), {
            'device': 'FMX150',
            'models': ['FMB150', 'FMC150', 'FMM150'],
            'updated': '2026-02-06',
            'source': 'Teltonika FMX150 Supported Vehicles 06/02/2026',
        }),
        ('lvcan200.json', extract_4p, os.path.join(data_dir, 'lvcan200.xlsx'), {
            'device': 'LV-CAN200',
            'models': ['FMB110', 'FMB120', 'FMB122', 'FMB125', 'FMC125', 'FMM125', 'FMB130', 'FMC130', 'FMM130', 'FMB140'],
            'adapter': True,
            'updated': '2026-07-03',
            'source': 'Teltonika LV-CAN200 (4P) List 2026/07/03',
        }),
        ('allcan300.json', extract_4p, os.path.join(data_dir, 'allcan300.xlsx'), {
            'device': 'ALL-CAN300',
            'models': ['FMB110', 'FMB120', 'FMB122', 'FMB125', 'FMC125', 'FMM125', 'FMB130', 'FMC130', 'FMM130', 'FMB140'],
            'adapter': True,
            'updated': '2026-07-03',
            'source': 'Teltonika ALL-CAN300 (4P) List 2026/07/03',
        }),
    ]
    for out_name, fn, src, meta in jobs:
        data = fn(src, meta)
        path = os.path.join(OUT, out_name)
        with open(path, 'w') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        print(f'{out_name}: {len(data["vehicles"])} vehicles, {len(data["params"])} params, '
              f'{os.path.getsize(path) // 1024} KB')


if __name__ == '__main__':
    main()
