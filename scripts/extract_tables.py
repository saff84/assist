#!/usr/bin/env python3
import argparse
import json
import re
import sys
from io import StringIO
from typing import Any, Dict, List, Optional, Tuple


HEADER_CANONICAL = {
    "Характеристика": [
        "характеристика",
        "параметр",
        "наименование параметра",
        "показатель",
    ],
    "Ед. изм": [
        "ед. изм",
        "ед изм",
        "единица измерения",
        "единицы измерения",
        "единица",
    ],
    "Значение": [
        "значение",
        "параметр значение",
        "value",
    ],
    "Артикул": [
        "артикул",
        "код",
        "sku",
        "article",
    ],
    "Наименование": [
        "наименование",
        "название",
        "модель",
    ],
}


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value)
    text = text.replace("\n", " ").replace("\r", " ")
    text = re.sub(r"\s+", " ", text).strip()
    return text


def looks_like_noise_column(name: str) -> bool:
    t = clean_text(name)
    if not t:
        return True
    if re.fullmatch(r"\d+", t):
        return True
    if len(t) <= 2 and re.fullmatch(r"[\d\-]+", t):
        return True
    return False


def dedupe_headers(headers: List[str]) -> List[str]:
    counts: Dict[str, int] = {}
    result: List[str] = []
    for i, h in enumerate(headers):
        base = clean_text(h) or f"Колонка {i + 1}"
        n = counts.get(base, 0) + 1
        counts[base] = n
        result.append(base if n == 1 else f"{base} {n}")
    return result


def normalize_headers(headers: List[str]) -> List[str]:
    try:
        from rapidfuzz import fuzz  # type: ignore
    except Exception:
        return dedupe_headers(headers)

    alias_to_canonical: List[Tuple[str, str]] = []
    for canonical, aliases in HEADER_CANONICAL.items():
        for a in aliases:
            alias_to_canonical.append((a, canonical))

    normalized: List[str] = []
    for idx, h in enumerate(headers):
        src = clean_text(h).lower()
        if not src:
            normalized.append(f"Колонка {idx + 1}")
            continue
        best_score = -1
        best_canonical: Optional[str] = None
        for alias, canonical in alias_to_canonical:
            score = fuzz.ratio(src, alias)
            if score > best_score:
                best_score = score
                best_canonical = canonical
        if best_score >= 86 and best_canonical:
            normalized.append(best_canonical)
        else:
            raw_clean = clean_text(h)
            raw_lower = raw_clean.lower()
            contains_match: Optional[str] = None
            for canonical, aliases in HEADER_CANONICAL.items():
                if any(alias in raw_lower for alias in aliases):
                    contains_match = canonical
                    break
            normalized.append(contains_match or raw_clean)

    return dedupe_headers(normalized)


def reorder_headers_and_records(
    headers: List[str], records: List[Dict[str, Any]]
) -> Tuple[List[str], List[Dict[str, Any]]]:
    tech_order = ["Характеристика", "Ед. изм", "Значение"]
    tech_present = [h for h in tech_order if h in headers]
    if len(tech_present) >= 2:
        final_headers = tech_present + [h for h in headers if h not in tech_present]
        return final_headers, [{h: rec.get(h) for h in final_headers} for rec in records]

    nomenclature_patterns = [
        (r"артикул", "Артикул"),
        (r"наимен", "Наименование"),
        (r"диаметр", "Диаметр наружный, мм"),
        (r"толщин", "Толщина стенки, мм"),
        (r"длина", "Длина бухты, м"),
    ]
    picked: List[str] = []
    for pattern, _ in nomenclature_patterns:
        col = next((h for h in headers if re.search(pattern, h, re.IGNORECASE)), None)
        if col and col not in picked:
            picked.append(col)

    if len(picked) >= 3:
        final_headers = picked + [h for h in headers if h not in picked]
        return final_headers, [{h: rec.get(h) for h in final_headers} for rec in records]

    return headers, records


def detect_technical_header_row(rows: List[List[str]]) -> int:
    """Detect real header row for technical tables and skip caption rows."""
    max_scan = min(4, len(rows))
    best_idx = 0
    best_score = -1
    for idx in range(max_scan):
        row = rows[idx]
        non_empty = sum(1 for cell in row if clean_text(cell))
        joined = " ".join(row).lower()
        marker_score = 0
        if re.search(r"характерист", joined):
            marker_score += 1
        if re.search(r"ед\.?\s*изм|единиц", joined):
            marker_score += 1
        if re.search(r"значен", joined):
            marker_score += 1
        score = marker_score * 10 + min(non_empty, 3)
        if marker_score >= 2 and score > best_score:
            best_score = score
            best_idx = idx
    return best_idx if best_score >= 0 else 0


def table_matrix_to_records(matrix: List[List[Any]]) -> Optional[Dict[str, Any]]:
    if not matrix:
        return None
    rows = [[clean_text(c) for c in row] for row in matrix]
    rows = [row for row in rows if any(cell for cell in row)]
    if len(rows) < 2:
        return None

    width = max(len(r) for r in rows)
    if width < 2:
        return None
    rows = [r + [""] * (width - len(r)) for r in rows]

    header_row_idx = detect_technical_header_row(rows)
    raw_headers = rows[header_row_idx]
    headers = normalize_headers(raw_headers)

    keep_indices = [i for i, h in enumerate(headers) if not looks_like_noise_column(h)]
    if len(keep_indices) < 2:
        return None

    headers = [headers[i] for i in keep_indices]
    body_rows = rows[header_row_idx + 1 :]

    records: List[Dict[str, Any]] = []
    for row in body_rows:
        selected = [row[i] if i < len(row) else "" for i in keep_indices]
        if not any(v for v in selected):
            continue
        record: Dict[str, Any] = {}
        for i, value in enumerate(selected):
            record[headers[i]] = value if value != "" else None
        records.append(record)

    if not records:
        return None

    headers, records = reorder_headers_and_records(headers, records)

    score = min(1.0, 0.45 + len(records) * 0.015 + len(headers) * 0.02)
    preview = " ".join(
        " ".join(clean_text(v) for v in rec.values() if v) for rec in records[:3]
    )
    return {
        "columns": headers,
        "rows": records,
        "score": score,
        "preview": clean_text(preview)[:600],
    }


def render_pdf_page_to_image(pdf_path: str, page: int):
    try:
        import fitz  # type: ignore
        import numpy as np  # type: ignore
    except Exception:
        return None

    try:
        doc = fitz.open(pdf_path)
        if page < 1 or page > len(doc):
            return None
        p = doc[page - 1]
        pix = p.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
        # PP-Structure expects BGR image.
        if pix.n >= 3:
            arr = arr[:, :, :3][:, :, ::-1]
        return arr
    except Exception:
        return None


def parse_html_table_to_records(html: str) -> Optional[Dict[str, Any]]:
    if not html or "<table" not in html.lower():
        return None

    try:
        import pandas as pd  # type: ignore
    except Exception:
        return None

    try:
        frames = pd.read_html(StringIO(html))
    except Exception:
        return None

    if not frames:
        return None

    df = frames[0]
    if df.empty:
        return None

    if hasattr(df.columns, "levels"):
        cols: List[str] = []
        for col in df.columns.tolist():
            if isinstance(col, tuple):
                parts = [clean_text(c) for c in col if clean_text(c)]
                cols.append(" ".join(parts).strip())
            else:
                cols.append(clean_text(col))
    else:
        cols = [clean_text(c) for c in df.columns.tolist()]

    matrix: List[List[Any]] = [cols]
    matrix.extend(df.fillna("").values.tolist())
    return table_matrix_to_records(matrix)


def extract_with_ppstructure(pdf_path: str, page: int) -> List[Dict[str, Any]]:
    try:
        from paddleocr import PPStructure  # type: ignore
    except Exception:
        return []

    image = render_pdf_page_to_image(pdf_path, page)
    if image is None:
        return []
    img_h, img_w = image.shape[:2]

    try:
        table_engine = PPStructure(
            show_log=False,
            lang="ru",
            layout=False,
        )
        result = table_engine(image)
    except Exception:
        return []

    tables: List[Dict[str, Any]] = []
    for block in result or []:
        if not isinstance(block, dict):
            continue
        if str(block.get("type", "")).lower() != "table":
            continue
        block_res = block.get("res") or {}
        html = ""
        if isinstance(block_res, dict):
            html = str(block_res.get("html") or "")
        parsed = parse_html_table_to_records(html)
        if not parsed:
            continue
        parsed["source"] = "ppstructure"
        block_score = block.get("score")
        if isinstance(block_score, (int, float)):
            parsed["score"] = min(1.0, float(parsed.get("score", 0.0)) + float(block_score) * 0.2)
        bbox = block.get("bbox")
        if (
            isinstance(bbox, (list, tuple))
            and len(bbox) == 4
            and img_w > 0
            and img_h > 0
        ):
            x1, y1, x2, y2 = [float(v) for v in bbox]
            nx = max(0.0, min(1.0, x1 / img_w))
            ny = max(0.0, min(1.0, y1 / img_h))
            nw = max(0.0, min(1.0, (x2 - x1) / img_w))
            nh = max(0.0, min(1.0, (y2 - y1) / img_h))
            parsed["bbox"] = {"x": nx, "y": ny, "width": nw, "height": nh}
        tables.append(parsed)

    return tables


def dedupe_tables(tables: List[Dict[str, Any]], page: int) -> List[Dict[str, Any]]:
    seen = set()
    out: List[Dict[str, Any]] = []
    for t in sorted(tables, key=lambda x: float(x.get("score", 0.0)), reverse=True):
        key = json.dumps({"c": t.get("columns"), "r": t.get("rows")}, ensure_ascii=False, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {
                "page": page,
                "columns": t.get("columns") or [],
                "rows": t.get("rows") or [],
                "source": t.get("source", "unknown"),
                "score": float(t.get("score", 0.0)),
                "preview": t.get("preview", ""),
                "bbox": t.get("bbox"),
            }
        )
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--page", required=True, type=int)
    args = parser.parse_args()

    pdf_path = args.file
    page = args.page

    try:
        tables = extract_with_ppstructure(pdf_path, page)

        payload = {
            "ok": True,
            "tables": dedupe_tables(tables, page),
        }
        print(json.dumps(payload, ensure_ascii=False))
        return 0
    except Exception as exc:
        payload = {
            "ok": False,
            "error": str(exc),
            "tables": [],
        }
        print(json.dumps(payload, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
