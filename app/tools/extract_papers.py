#!/usr/bin/env python3
"""GATE question-paper PDFs -> structured question bank (JSON + PNG crops).

Usage (from anywhere):
    app/tools/.venv/bin/python app/tools/extract_papers.py            # all papers
    app/tools/.venv/bin/python app/tools/extract_papers.py 2024-CS1   # some papers
    app/tools/.venv/bin/python app/tools/extract_papers.py --no-ocr   # skip OCR (fast, image-only papers get empty text)

Outputs (never touches papers/):
    app/data/questions/<paper-id>.json   list of question objects (schema in app/spec/03-question-pipeline.md)
    app/data/questions/_summary.json     per-paper counts + needs_review reasons
    app/data/img/<paper-id>-q<n>.png     crop of the whole question (only when needed / always for scanned papers)

Four source "kinds" exist because the official PDFs come in very different shapes:
    text      born-digital PDFs with a real text layer (2018, 2022-2026, DA 2024-2026 and the DA sample)
    byjus17   2017: re-typeset by a third party; question bodies are images, headers + key are text
    scan19    2019: pure scan, no text layer at all (anchors found via OCR)
    layer20   2020: question bodies are images, but "Q.No. n" / "(A)" markers are in a text layer
    box21     2021: pages sliced into image strips, each question in a bordered table; key is an image
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image

pymupdf.TOOLS.mupdf_display_errors(False)

ROOT = Path(__file__).resolve().parents[2]
PAPERS = ROOT / "papers"
DATA = ROOT / "app" / "data"
IMG = DATA / "img"
QDIR = DATA / "questions"
CACHE = ROOT / "app" / "tools" / ".cache"
DPI = 130          # crop render resolution
OCR_ENABLED = True

# ------------------------------------------------------------------ registry
REG = []


def reg(pid, year, paper, session, pdf, key, kind, **kw):
    REG.append(dict(id=pid, year=year, paper=paper, session=session, pdf=pdf, key=key, kind=kind, **kw))


reg("2017-CS1", 2017, "CS", "CS1", "CS/2017-CS.pdf", "embedded", "byjus17", set_no=1)
reg("2017-CS2", 2017, "CS", "CS2", "CS/2017-CS.pdf", "embedded", "byjus17", set_no=2)
reg("2018-CS", 2018, "CS", "CS", "CS/2018-CS.pdf", "CS/2018-CS-key.pdf", "text")
reg("2019-CS", 2019, "CS", "CS", "CS/2019-CS.pdf", None, "scan19")
reg("2020-CS", 2020, "CS", "CS", "CS/2020-CS.pdf", None, "layer20")
reg("2021-CS1", 2021, "CS", "CS1", "CS/2021-CS.pdf", "CS/2021-CS-key.pdf", "box21", set_no=1)
reg("2021-CS2", 2021, "CS", "CS2", "CS/2021-CS.pdf", "CS/2021-CS-key.pdf", "box21", set_no=2)
reg("2022-CS", 2022, "CS", "CS", "CS/2022-CS.pdf", "CS/2022-CS-key.pdf", "text")
reg("2023-CS", 2023, "CS", "CS", "CS/2023-CS.pdf", "CS/2023-CS-key.pdf", "text")
for y in (2024, 2025, 2026):
    for s in (1, 2):
        reg(f"{y}-CS{s}", y, "CS", f"CS{s}", f"CS/{y}-CS{s}.pdf", f"CS/{y}-CS{s}-key.pdf", "text")
reg("2024-DA", 2024, "DA", "DA", "DA/2024-DA.pdf", "DA/2024-DA-key.pdf", "text")
reg("2024-DA-sample", 2024, "DA", "DA-sample", "DA/2024-DA-sample.pdf", None, "text", sample=True)
reg("2025-DA", 2025, "DA", "DA", "DA/2025-DA.pdf", "DA/2025-DA-key.pdf", "text")
reg("2026-DA", 2026, "DA", "DA", "DA/2026-DA.pdf", "DA/2026-DA-key.pdf", "text")

TYPES = {"MCQ", "MSQ", "NAT"}


# ------------------------------------------------------------------ OCR (macOS Vision, cached)
def ocr_image_bytes(png_bytes, accurate=True):
    import Vision
    from Foundation import NSData
    data = NSData.dataWithBytes_length_(png_bytes, len(png_bytes))
    h = Vision.VNImageRequestHandler.alloc().initWithData_options_(data, None)
    r = Vision.VNRecognizeTextRequest.alloc().init()
    r.setRecognitionLevel_(0 if accurate else 1)
    r.setUsesLanguageCorrection_(True)
    h.performRequests_error_([r], None)
    out = []
    for o in r.results():
        bb = o.boundingBox()
        out.append(dict(y0=1 - bb.origin.y - bb.size.height, y1=1 - bb.origin.y, x0=bb.origin.x,
                        x1=bb.origin.x + bb.size.width, t=o.topCandidates_(1)[0].string()))
    out.sort(key=lambda d: (round(d["y0"], 2), d["x0"]))
    return out


def ocr_page(pdf_path, doc, pno, dpi=150, accurate=True):
    """OCR one PDF page; results cached on disk as json (normalised 0..1 coordinates, y down)."""
    if not OCR_ENABLED:
        return []
    CACHE.mkdir(parents=True, exist_ok=True)
    cf = CACHE / f"{Path(pdf_path).stem}-p{pno}-{dpi}-{int(accurate)}.json"
    if cf.exists():
        return json.loads(cf.read_text())
    res = ocr_image_bytes(doc[pno].get_pixmap(dpi=dpi).tobytes("png"), accurate)
    cf.write_text(json.dumps(res))
    return res


def ocr_strip(pdf_path, doc, pno, x0f, x1f, dpi=250):
    """OCR only a vertical strip of a page (fractions of page width). Isolated 'Q.n' labels are read far
    more reliably this way than inside full-page OCR. Returned y is fraction of page height."""
    if not OCR_ENABLED:
        return []
    CACHE.mkdir(parents=True, exist_ok=True)
    cf = CACHE / f"{Path(pdf_path).stem}-p{pno}-strip{x0f}-{x1f}-{dpi}.json"
    if cf.exists():
        return json.loads(cf.read_text())
    pg = doc[pno]
    W, H = pg.rect.width, pg.rect.height
    pm = pg.get_pixmap(dpi=dpi, clip=pymupdf.Rect(x0f * W, 0, x1f * W, H))
    res = ocr_image_bytes(pm.tobytes("png"))
    cf.write_text(json.dumps(res))
    return res


def ocr_text_of_png(path):
    if not OCR_ENABLED:
        return ""
    lines = ocr_image_bytes(Path(path).read_bytes(), True)
    # re-group observations into visual rows
    rows = []
    for l in lines:
        if rows and abs(rows[-1][0] - l["y0"]) < 0.012:
            rows[-1][1].append(l)
        else:
            rows.append([l["y0"], [l]])
    return "\n".join(" ".join(x["t"] for x in sorted(r[1], key=lambda d: d["x0"])) for r in rows)


# ------------------------------------------------------------------ answer keys
NUM = r"-?\d+(?:\.\d+)?"


def group_rows(words, tol):
    words = sorted(words, key=lambda w: ((w[1] + w[3]) / 2, w[0]))
    rows = []
    for w in words:
        cy = (w[1] + w[3]) / 2
        if rows and abs(rows[-1]["cy"] - cy) <= tol:
            rows[-1]["w"].append(w)
        else:
            rows.append({"cy": cy, "w": [w]})
    for r in rows:
        r["w"].sort(key=lambda w: w[0])
        r["t"] = [w[4].strip() for w in r["w"] if w[4].strip()]
    return rows


def parse_answer(typ, ks):
    ks = ks.strip()
    if re.search(r"\bMTA\b", ks, re.I):     # "marks to all": question dropped / everyone credited
        return "MTA"
    if typ == "MCQ":
        if re.search(r"\bOR\b", ks, re.I):     # e.g. "C OR D": either accepted
            return re.findall(r"[A-D]", ks.upper()) or None
        mm = re.match(r"^([A-D])\b", ks, re.I)
        return mm.group(1).upper() if mm else None
    if typ == "MSQ":
        return re.findall(r"[A-D]", ks.upper()) or None
    pairs = re.findall(rf"({NUM})\s*to\s*({NUM})", ks)
    return {"ranges": [[float(a), float(b)] for a, b in pairs]} if pairs else None


def key_from_ocr_columns(path, pages, cols, dpi=300, n_expected=65, anchor_cols=("qno",)):
    """Key tables in image PDFs: whole-page OCR drops lone cells ('A', '1'), so OCR each column as its own
    vertical strip and align rows on the Q.No. column. cols = {'qno':(x0,x1), 'key':(..), 'type':(..)?, 'marks':(..)?}.
    Row ordinal is the continuous question number (1..65); the printed Q.No. is only used as a sanity check
    (it restarts after the 10 GA rows in 2018-2020 keys)."""
    doc = pymupdf.open(path)
    rows = []
    for pno in pages:
        strips = {}
        for k, (a, b) in cols.items():     # union of several resolutions: Vision is flaky on lone glyphs
            acc = []
            for dp in (250, 300, 200, 400, 350):
                for o in ocr_strip(path, doc, pno, a, b, dpi=dp):
                    if not any(abs(o["y0"] - x["y0"]) < 0.008 for x in acc):
                        acc.append(o)
            strips[k] = sorted(acc, key=lambda o: o["y0"])
        anchors = []     # one per table row: y of any readable anchor-column cell
        for ak in anchor_cols:
            for o in strips[ak]:
                t = o["t"].strip()
                ok = re.fullmatch(r"\d{1,2}", t) if ak == "qno" else re.fullmatch(r"(MCQ|MSQ|NAT|GA|CS|DA)", t.upper().replace(" ", ""))
                if ok and not any(abs(o["y0"] - a_["y0"]) < 0.008 for a_ in anchors):
                    anchors.append(dict(y0=o["y0"], printed=int(t) if ak == "qno" else None))
        anchors.sort(key=lambda a_: a_["y0"])
        for q in anchors:
            cells = {}
            for k, obs in strips.items():
                if k == "qno":
                    continue
                near = [(o["y0"], o["t"]) for o in obs if abs(o["y0"] - q["y0"]) < 0.0095 or
                        (k == "key" and -0.012 < o["y0"] - q["y0"] < 0.03 and
                         all(abs(o["y0"] - q2["y0"]) >= abs(o["y0"] - q["y0"]) for q2 in anchors))]
                cells[k] = " ".join(x[1] for x in sorted(near))
            rows.append((q["printed"], cells))
    out = {}
    for ordinal, (printed, c) in enumerate(rows, 1):
        ks = c.get("key", "")
        tt = c.get("type", "").upper().replace(" ", "")
        typ = tt if tt in TYPES else ("NAT" if " to " in f" {ks} " else ("MSQ" if re.search(r"[A-D]\s*;\s*[A-D]", ks) else "MCQ"))
        try:
            marks = float(c["marks"].strip()) if c.get("marks", "").strip() in ("1", "2") else None
        except ValueError:
            marks = None
        out[ordinal] = dict(type=typ, section="GA" if ordinal <= 10 else "subject", session=None, key_raw=ks,
                            answer=parse_answer(typ, ks), marks=marks, printed_qno=printed,
                            type_from_column=tt in TYPES,
                            printed_mismatch=printed is not None and printed != (ordinal if ordinal <= 10 else ordinal - 10))
    return out


def ocr_clip(path, doc, pno, rect, dpi=400, pad=12):
    """OCR one small clip (a table cell), upscaled and padded with white; cached."""
    CACHE.mkdir(parents=True, exist_ok=True)
    cf = CACHE / f"{Path(path).stem}-p{pno}-clip{'-'.join(str(round(v)) for v in rect)}-{dpi}.json"
    if cf.exists():
        return json.loads(cf.read_text())
    pm = doc[pno].get_pixmap(dpi=dpi, clip=pymupdf.Rect(*rect))
    im = Image.frombytes("RGB", (pm.w, pm.h), pm.samples)
    canvas = Image.new("RGB", (im.width + 2 * pad, im.height + 2 * pad), "white")
    canvas.paste(im, (pad, pad))
    import io
    buf = io.BytesIO()
    canvas.save(buf, "PNG")
    txt = " ".join(o["t"] for o in ocr_image_bytes(buf.getvalue()))
    cf.write_text(json.dumps(txt))
    return txt


def key_from_grid(path, pages, xc, x_line=(0.27, 0.70), top_min=0.19):
    """Key table drawn with ruled lines (2020 screenshot): find the row rules in pixels, OCR each cell on its own.
    xc = {'type':(x0,x1), 'key':(..), 'marks':(..)} as fractions of page width."""
    doc = pymupdf.open(path)
    rows = []
    for pno in pages:
        pm = doc[pno].get_pixmap(dpi=200, colorspace=pymupdf.csGRAY)
        a = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.h, pm.w)
        frac = (a[:, int(x_line[0] * pm.w):int(x_line[1] * pm.w)] < 200).mean(1)
        lines = []
        for y in range(pm.h):
            if frac[y] > 0.6 and y / pm.h > (top_min if pno == pages[0] else 0.03):
                if not lines or y - lines[-1][-1] > 2:
                    lines.append([y])
                else:
                    lines[-1].append(y)
        ys = [l[0] / pm.h for l in lines]
        if pno == pages[0]:
            ys = ys[1:]          # first rule above is the header row's bottom edge
        H, W = doc[pno].rect.height, doc[pno].rect.width
        pitch = np.median(np.diff(ys)) if len(ys) > 2 else 0.0175
        ys2 = ys + [ys[-1] + pitch]    # the table's last rule may be missing
        for y0, y1 in zip(ys2[:-1], ys2[1:]):
            cells = {k: ocr_clip(path, doc, pno, (x0 * W, (y0 + 0.002) * H, x1 * W, (y1 - 0.001) * H)) for k, (x0, x1) in xc.items()}
            cells["_feat"] = glyph_feature(doc, pno, ((0.505) * W, (y0 + 0.002) * H, 0.665 * W, (y1 - 0.001) * H))
            rows.append(cells)
    # single letters are unreadable for OCR at this resolution: classify them by template matching against
    # the letters OCR *did* read on the same table (same font, same scale)
    tmpl = {}
    for c in rows:
        k_ = c["key"].strip()
        if k_ in ("A", "B", "C", "D") and c["_feat"] is not None:
            tmpl.setdefault(k_, []).append(c["_feat"])
    tmpl = {k_: np.mean(v, 0) for k_, v in tmpl.items()}
    for c in rows:
        if (not c["key"].strip()) and c["type"].upper().replace(" ", "") in ("MCQ", "") and c["_feat"] is not None and len(tmpl) >= 4:
            best = min(tmpl, key=lambda k_: float(((tmpl[k_] - c["_feat"]) ** 2).sum()))
            c["key"] = best
            c["_guess"] = True
    out = {}
    for ordinal, c in enumerate(rows, 1):
        ks = re.sub(r"^\s*(GA|CS)\b", "", c["key"].strip(), flags=re.I).strip()   # clip includes the section cell
        if not ks and not c["type"].strip():
            continue
        tt = c["type"].upper().replace(" ", "")
        typ = tt if tt in TYPES else ("NAT" if " to " in f" {ks} " else "MCQ")
        out[ordinal] = dict(type=typ, section="GA" if ordinal <= 10 else "subject", session=None, key_raw=ks,
                            answer=parse_answer(typ, ks), marks=None, type_from_column=tt in TYPES,
                            guessed=bool(c.get("_guess")))
    return out


def glyph_feature(doc, pno, rect, size=20):
    pm = doc[pno].get_pixmap(dpi=300, clip=pymupdf.Rect(*rect), colorspace=pymupdf.csGRAY)
    a = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.h, pm.w)
    ink = a < 150
    if ink.sum() < 15:
        return None
    ys, xs = np.where(ink)
    g = Image.fromarray(((~ink[ys.min():ys.max() + 1, xs.min():xs.max() + 1]) * 255).astype(np.uint8))
    return np.asarray(g.resize((size, size)), dtype=float) / 255


def parse_key_rows(rows, ntail, tol):
    """rows: list of {cy, t[]} for ONE key table (possibly several pages stacked, cy made monotone by caller).
    Returns {q_no: dict(type, section, session, key_raw, answer, marks)}."""
    main, cont = [], []
    SECT = re.compile(r"^(GA|CS|DA)(-?\d)?$", re.I)
    for r in rows:
        t = r["t"]
        if len(t) >= 4 and re.fullmatch(r"\d{1,3}", t[0]) and any(
                x.upper() in TYPES or SECT.match(x) for x in t[1:5]):
            main.append(r)
        elif t and all(re.fullmatch(rf"OR|to|{NUM}", x, re.I) for x in t):
            cont.append(r)
    out = {}
    pre = {id(m): [] for m in main}
    post = {id(m): [] for m in main}
    for c in cont:  # continuation of a wrapped key cell: attach to the closest main row
        if not main:
            break
        m = min(main, key=lambda m: abs(m["cy"] - c["cy"]))
        if abs(m["cy"] - c["cy"]) < tol * 6:
            (pre if c["cy"] < m["cy"] else post)[id(m)].extend(c["t"])
    off, prev = 0, 0
    for m in main:
        t = m["t"]
        si = next(i for i in range(1, 5) if SECT.match(t[i]) or t[i].upper() in TYPES)
        if t[si].upper() in TYPES:
            ti, i = si, si
            typ_tok = t[si].upper()
            i = si
        else:
            typ_tok = t[si - 1].upper() if t[si - 1].upper() in TYPES else None
            i = si - 1   # position of (virtual) type token
        qn = int(t[0])
        if qn < prev and off == 0 and prev <= 10:   # 2018-style key: subject numbering restarts at 1
            off = prev
        prev = qn
        qn += off
        session = t[1] if (i >= 2 and re.fullmatch(r"\d+", t[1])) else None
        section = t[si + 1] if t[si].upper() in TYPES else t[si]
        rest = t[si + 2:] if t[si].upper() in TYPES else t[si + 1:]
        typ = typ_tok
        tail = rest[-ntail:] if ntail and len(rest) >= ntail else []
        keytok = pre[id(m)] + (rest[:-ntail] if ntail else rest) + post[id(m)]
        ks = " ".join(keytok)
        if not tail and ntail == 0 and rest:
            # marks is the last token when there is no negative column
            pass
        if ntail == 0:
            tail, keytok = rest[-1:], rest[:-1]
            ks = " ".join(pre[id(m)] + keytok + post[id(m)])
        try:
            marks = float(tail[0]) if tail else None
        except ValueError:
            marks = None
        if typ is None:    # type column unreadable (grey cells in 2019 scan): infer from key format
            typ = "NAT" if " to " in f" {ks} " else ("MSQ" if re.search(r"[A-D]\s*;\s*[A-D]", ks) else "MCQ")
        ans = parse_answer(typ, ks)
        out[qn] = dict(type=typ, section=section, session=session, key_raw=ks, answer=ans, marks=marks)
    return out


def key_from_text_pdf(path, pages=None):
    doc = pymupdf.open(path)
    rows, off = [], 0
    for pno in (pages if pages is not None else range(len(doc))):
        p = doc[pno]
        rr = group_rows([w[:5] for w in p.get_text("words")], 3)
        for r in rr:
            r["cy"] += off
        rows += rr
        off += p.rect.height + 100
    return parse_key_rows(rows, 0, 3)


def key_from_ocr_pdf(path, pages, ntail=2, dpi=220):
    doc = pymupdf.open(path)
    rows, off = [], 0
    for pno in pages:
        obs = ocr_page(path, doc, pno, dpi=dpi, accurate=True)
        words = []
        for o in obs:  # split observations into words, positioned proportionally
            toks = o["t"].split()
            if not toks:
                continue
            wdt = (o["x1"] - o["x0"]) / len(toks)
            for k, tk in enumerate(toks):
                words.append((o["x0"] + k * wdt, o["y0"], o["x0"] + (k + 1) * wdt, o["y1"], tk))
        rr = group_rows(words, 0.006)
        for r in rr:
            r["cy"] += off
        rows += rr
        off += 2
    return parse_key_rows(rows, ntail, 0.006)


def neg_marks(qtype, marks):
    if qtype == "MCQ" and marks:
        return round(marks / 3, 4)
    return 0


# ------------------------------------------------------------------ image helpers
def render_segments(doc, segs, dpi=DPI):
    """segs: list of (page_no, y0, y1, x0, x1) in PDF points -> one stitched, whitespace-trimmed PIL image."""
    parts = []
    for pno, y0, y1, x0, x1 in segs:
        if y1 - y0 < 4:
            continue
        pm = doc[pno].get_pixmap(dpi=dpi, clip=pymupdf.Rect(x0, y0, x1, y1), colorspace=pymupdf.csRGB)
        parts.append(Image.frombytes("RGB", (pm.w, pm.h), pm.samples))
    if not parts:
        return None
    parts = [trim(p) for p in parts]
    parts = [p for p in parts if p is not None]
    if not parts:
        return None
    w = max(p.width for p in parts)
    h = sum(p.height for p in parts)
    canvas = Image.new("RGB", (w, h), "white")
    y = 0
    for p in parts:
        canvas.paste(p, (0, y))
        y += p.height
    return canvas


def trim(im, pad=6):
    a = np.asarray(im.convert("L"))
    mask = a < 235
    rows = np.where(mask.sum(1) > 0)[0]
    cols = np.where(mask.sum(0) > 0)[0]
    if len(rows) == 0:
        return None
    y0, y1 = max(rows[0] - pad, 0), min(rows[-1] + pad, a.shape[0])
    x0, x1 = max(cols[0] - pad, 0), min(cols[-1] + pad, a.shape[1])
    return im.crop((x0, y0, x1, y1))


def save_img(im, pid, qn):
    IMG.mkdir(parents=True, exist_ok=True)
    name = f"{pid}-q{qn}.png"
    im.save(IMG / name, optimize=True)
    return f"img/{name}"


# ------------------------------------------------------------------ text papers
NOISE = [
    r"\bPage\s*\d+\s*of\s*\d+", r"Organi[sz]ing Institute", r"^GATE\s*20\d\d\b",
    r"^(Computer Science|Data Science|General Aptitude)\b[^?]{0,80}$",
    r"^(CS|DA|GA)\s*\d?$", r"^\d+\s*/\s*\d+$", r"^Set[- ]?\d", r"^Q\.?\s*\d+\s*[–—-]\s*(Q\.?\s*)?\d+",
    r"^[–—-]\s*Q\.?\s*\d+\s+Carry", r"\bCarry\s+(ONE|TWO)\s+marks?\b", r"^SESSION\b",
]
NOISE_RE = [re.compile(p, re.I) for p in NOISE]
ANCHOR_RE = re.compile(r"^Q\.?\s*(\d{1,2})(?!\d)(?![\s]*[–—-]\s*Q)\s*(.*)$", re.S)
MONO_RE = re.compile(r"courier|consolas|mono|menlo|lucida\s*console|cour", re.I)
MATHFONT_RE = re.compile(r"math|symbol|cmmi|cmsy|cmex|cmr|stix|mt-?extra|euclid|lmroman|lmmath", re.I)
CODE_RE = re.compile(r"[;{}]\s*$|#include|\bprintf\b|\bscanf\b|\bint\s+\w+\s*[=(;\[]|\bwhile\s*\(|\bfor\s*\(|"
                     r"\bSELECT\b|\bFROM\b|\bWHERE\b|\breturn\b|\bif\s*\(|\bvoid\b|->|\+\+|==|&&|\|\||:=")
ALLOWED_NONASCII = set("‘’“”–—…•₹°×·    −")


def is_noise(t):
    return any(r.search(t) for r in NOISE_RE)


def page_rows(page):
    """Visual rows of a page: PyMuPDF lines merged when they overlap vertically (handles table layouts
    where '(A)' and the option text are separate cells)."""
    lines = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for l in b["lines"]:
            sp = [s for s in l["spans"] if s["text"].strip()]
            if not sp:
                continue
            txt = "".join(s["text"] for s in l["spans"]).strip()
            mx = max(s["size"] for s in sp)
            sub = any(s["size"] < 0.82 * mx for s in sp)
            fonts = " ".join(s["font"] for s in sp)
            x0, y0, x1, y1 = l["bbox"]
            lines.append(dict(x0=x0, y0=y0, x1=x1, y1=y1, t=txt, sub=sub,
                              math=bool(MATHFONT_RE.search(fonts)), mono=bool(MONO_RE.search(fonts))))
    lines.sort(key=lambda d: (d["y0"], d["x0"]))
    rows = []
    for l in lines:
        for r in rows[-3:]:
            ov = min(r["y1"], l["y1"]) - max(r["y0"], l["y0"])
            if ov > 0.5 * min(r["y1"] - r["y0"], l["y1"] - l["y0"]):
                r["parts"].append(l)
                r["y0"], r["y1"] = min(r["y0"], l["y0"]), max(r["y1"], l["y1"])
                break
        else:
            rows.append(dict(y0=l["y0"], y1=l["y1"], parts=[l]))
    for r in rows:
        r["parts"].sort(key=lambda d: d["x0"])
        r["x0"] = r["parts"][0]["x0"]
        r["t"] = " ".join(p["t"] for p in r["parts"]).strip()
        r["sub"] = any(p["sub"] for p in r["parts"])
        r["math"] = any(p["math"] for p in r["parts"])
        r["mono"] = any(p["mono"] for p in r["parts"])
    rows.sort(key=lambda r: (r["y0"], r["x0"]))
    return rows


def split_options(text):
    """Return (stem, [optA..optD]) if a clean A-D sequence ends the text, else (text, [])."""
    ms = list(re.finditer(r"(?:^|\s)\(([A-D])\)\s*", text))
    for i in range(len(ms)):
        if ms[i].group(1) != "A":
            continue
        seq = [ms[i]]
        for m in ms[i + 1:]:
            if ord(m.group(1)) == ord(seq[-1].group(1)) + 1:
                seq.append(m)
        if len(seq) >= 2:
            stem = text[:seq[0].start()].strip()
            opts = []
            for k, m in enumerate(seq):
                end = seq[k + 1].start() if k + 1 < len(seq) else len(text)
                opts.append(re.sub(r"\s+", " ", text[m.end():end]).strip())
            return stem, opts
    return text, []


_REPEAT = {}
DEBUG = False
KEYPAGES = {}   # paper id -> (pdf path, [page numbers]) of key pages that were OCR'd (rendered for human/agent checking)


def repeated_sigs(doc):
    """Signatures of drawings/images that recur on many pages (watermarks, logos, table frames): ignored."""
    key = doc.name
    if key in _REPEAT:
        return _REPEAT[key]
    from collections import Counter
    cd, ci = Counter(), Counter()
    for page in doc:
        sd = {tuple(round(v / 4) for v in d["rect"]) for d in page.get_drawings()}
        si = {(im["width"], im["height"]) for im in page.get_image_info()}
        cd.update(sd)
        ci.update(si)
    thr = max(3, len(doc) // 8)
    _REPEAT[key] = ({s for s, c in cd.items() if c >= thr}, {s for s, c in ci.items() if c >= thr})
    return _REPEAT[key]


def drawings_in(page, rect, doc):
    n = 0
    W = page.rect.width
    rep = repeated_sigs(doc)[0]
    for d in page.get_drawings():
        r = d["rect"]
        if not (rect.y0 - 1 <= (r.y0 + r.y1) / 2 <= rect.y1 + 1):
            continue
        if min(r.width, r.height) < 1.5 or r.width > 0.6 * W:   # rules / table borders
            continue
        if tuple(round(v / 4) for v in r) in rep:
            continue
        n += 1
        if DEBUG:
            print("   drawing", d["type"], [round(v) for v in r])
    return n


def images_in(page, rect, doc):
    n = 0
    rep = repeated_sigs(doc)[1]
    for im in page.get_image_info():
        r = pymupdf.Rect(im["bbox"])
        if r.width < 6 or r.height < 6 or (im["width"], im["height"]) in rep:
            continue
        if rect.y0 - 1 <= (r.y0 + r.y1) / 2 <= rect.y1 + 1:
            n += 1
    return n


def extract_text_paper(r, doc, key):
    events = []   # (page, y0, kind, qn|None, row)
    page_lim = {}
    all_rows = {}
    for pno, page in enumerate(doc):
        H, W = page.rect.height, page.rect.width
        rows = page_rows(page)
        top, bot = 18.0, H - 18.0
        for row in rows:
            t = row["t"]
            m = ANCHOR_RE.match(t) if not is_noise(t) else None
            if is_noise(t):
                if row["y1"] < 0.14 * H:
                    top = max(top, row["y1"] + 2)
                elif row["y0"] > 0.86 * H:
                    bot = min(bot, row["y0"] - 2)
                else:
                    events.append((pno, row["y0"], "term", None, row))
                row["noise"] = True
            elif m and row["x0"] < 0.25 * W and not (m.group(2) and m.group(2)[:1] in ".,"):
                events.append((pno, row["y0"], "q", int(m.group(1)), row))
        page_lim[pno] = (top, bot)
        all_rows[pno] = rows
    events.sort(key=lambda e: (e[0], e[1]))

    qs = []
    seen = set()
    offset, prev_raw = 0, 0
    for i, (pno, y0, kind, qn, row) in enumerate(events):
        if kind != "q":
            continue
        if qn < prev_raw and offset == 0 and prev_raw <= 10:   # 2018-style: subject numbering restarts at Q.1
            offset = prev_raw
        prev_raw = qn
        raw_qn, qn = qn, qn + offset
        nxt = events[i + 1] if i + 1 < len(events) else None
        end_p, end_y = (nxt[0], nxt[1]) if nxt else (len(doc) - 1, None)
        texts, segs, flags = [], [], dict(sub=False, math=False, mono=False)
        for p in range(pno, end_p + 1):
            H, W = doc[p].rect.height, doc[p].rect.width
            top, bot = page_lim[p]
            ys = (y0 - 3) if p == pno else top
            ye = (end_y - 3) if (p == end_p and end_y is not None) else bot
            ye = min(ye, bot)
            ys = max(ys, top)
            if ye - ys < 3:
                continue
            segs.append((p, ys, ye, 36, W - 36))
            for rw in all_rows[p]:
                if rw.get("noise"):
                    continue
                if ys - 1 <= rw["y0"] and rw["y1"] <= ye + 3:
                    t = rw["t"]
                    if p == pno and rw is row:
                        t = ANCHOR_RE.match(t).group(2)
                    texts.append(t)
                    for k in flags:
                        flags[k] = flags[k] or rw[k]
                    if len(re.sub(r"\W", "", t)) <= 2 and t and not re.fullmatch(r"\(?[A-D]\)?", t):
                        flags["stack"] = True   # stacked numerators / denominators / exponents
        full = "\n".join(x for x in texts if x)
        stem, opts = split_options("\n".join(x for x in texts if x))
        stem = re.sub(r"[ \t]+", " ", stem).strip()
        # decide on image
        reasons = []
        nonascii = any(ord(c) > 127 and c not in ALLOWED_NONASCII for c in full)
        ni = sum(images_in(doc[p], pymupdf.Rect(0, s[1], 9999, s[2]), doc) for s in segs for p in [s[0]])
        nd = sum(drawings_in(doc[p], pymupdf.Rect(0, s[1], 9999, s[2]), doc) for s in segs for p in [s[0]])
        if ni:
            reasons.append("figure")
        if nd:
            reasons.append("drawing/table")
        if nonascii or flags["math"]:
            reasons.append("math")
        if flags["sub"] or flags.get("stack"):
            reasons.append("sub/superscript")
        if flags["mono"] or CODE_RE.search(full):
            reasons.append("code")
        qs.append(dict(qn=qn, raw_qn=raw_qn, stem=stem, opts=opts, segs=segs, render=reasons, pages=sorted({s[0] for s in segs}),
                       dup=qn in seen))
        seen.add(qn)
    return qs


def build_text_paper(r, doc, key):
    raw = extract_text_paper(r, doc, key)
    out, problems = [], []
    byqn = {}
    for q in raw:
        if q["qn"] in byqn:
            problems.append(f"duplicate anchor Q{q['qn']}")
            continue
        byqn[q["qn"]] = q
    expected = list(range(1, 66)) if not r.get("sample") else sorted(byqn)
    if key:
        expected = sorted(set(expected) | set(key))
    missing = [n for n in expected if n not in byqn]
    extra = [n for n in byqn if n not in expected]
    if missing:
        problems.append(f"missing questions {missing}")
    if extra:
        problems.append(f"unexpected question numbers {extra}")
    for qn in sorted(byqn):
        q = byqn[qn]
        k = (key or {}).get(qn)
        rev = []
        if key is not None and k is None:
            rev.append("no key row")
        qtype = k["type"] if k else None
        if qtype is None:   # keyless paper: infer
            qtype = "MCQ" if len(q["opts"]) == 4 else "NAT"
            rev.append("type inferred (no key)")
        if r.get("sample"):          # DA sample paper: 55 subject questions, Q1-25 one mark, Q26-55 two marks
            default_marks = 1 if qn <= 25 else 2
        else:
            default_marks = 1 if (qn <= 5 or 11 <= qn <= 35) else 2
        marks = k["marks"] if k and k["marks"] else default_marks
        if not (k and k["marks"]):
            rev.append("marks inferred")
        sect = "GA" if (k["section"].upper() == "GA" if k else (qn <= 10 and not r.get("sample"))) else "subject"
        if qtype in ("MCQ", "MSQ") and len(q["opts"]) != 4:
            rev.append(f"{len(q['opts'])} options parsed")
        if qtype == "NAT" and q["opts"]:
            rev.append("NAT but options parsed")
        if k and k["answer"] is None:
            rev.append("answer unparsed")
        image = None
        if q["render"] or rev:     # when in doubt, render
            im = render_segments(doc, q["segs"])
            if im is not None:
                image = save_img(im, r["id"], qn)
        out.append(make_q(r, qn, sect, qtype, marks, q["stem"], q["opts"] if qtype != "NAT" else [],
                          k["answer"] if k else None, image, rev, q["pages"],
                          text_quality="garbled-see-image" if q["render"] else "clean",
                          render_reasons=q["render"], key_session=k["session"] if k else None))
    return out, problems


def make_q(r, qn, sect, qtype, marks, text, options, answer, image, rev, pages, **extra):
    d = dict(
        id=f"{r['id']}-q{qn}", exam_year=r["year"], paper=r["paper"], session=r["session"], q_no=qn,
        section=sect, q_type=qtype, marks=marks, negative_marks=neg_marks(qtype, marks),
        text=text, options=options, answer=answer, image=image, needs_review=bool(rev),
        review_reasons=rev, source_pdf=r["pdf"], source_pages=[p + 1 for p in pages],
        answer_source="official-key" if answer is not None else None,
    )
    d["answer_mode"] = (None if answer is None else "mta" if answer == "MTA" else "range" if isinstance(answer, dict)
                        else ("all_of" if qtype == "MSQ" else "any_of" if isinstance(answer, list) else "single"))
    if r.get("sample"):
        d["sample_paper"] = True
    d.update(extra)
    return d


# ------------------------------------------------------------------ image-based papers
def seq_fix(cands, start_expected=1, total=None):
    """cands: [(page, y, number|None)] in doc order. Return list of (page, y, number, flag) with a monotone
    1..N numbering, tolerating OCR garbling (e.g. '1' for '11'). Missing numbers are reported."""
    out, exp, miss = [], start_expected, []
    for pg, y, c in cands:
        if c is None:
            continue
        s, e = str(c), str(exp)
        if c == exp or (c < exp and e.startswith(s) and len(s) < len(e)):
            out.append((pg, y, exp))
            exp += 1
        elif c == exp + 1:
            miss.append(exp)
            out.append((pg, y, c))
            exp = c + 1
        elif c == exp + 2 and c % 10 != 1:
            miss += [exp, exp + 1]
            out.append((pg, y, c))
            exp = c + 1
    if total:
        miss += list(range(exp, total + 1))
    return out, miss


def segs_between(doc, anchors, i, top_of, bot_of, term=None, x=(0, None), last_page=None):
    """Segments (page,y0,y1,x0,x1) from anchor i to anchor i+1 (anchors: [(page,y,..)]); term = list of
    (page,y) terminators that may end the segment earlier."""
    pg, y = anchors[i][0], anchors[i][1]
    last = i + 1 >= len(anchors)
    ep, ey = (anchors[i + 1][0], anchors[i + 1][1]) if not last else ((last_page if last_page is not None else len(doc) - 1), None)
    ends = [(ep, ey if ey is not None else bot_of(ep))]
    for tp, ty in (term or []):
        if (pg, y) < (tp, ty) < (ep, ey if ey is not None else 1e9):
            ends.append((tp, ty))
    ep, ey = min(ends)
    segs = []
    for p in range(pg, ep + 1):
        W = doc[p].rect.width
        ys = y - 3 if p == pg else top_of(p)
        ye = ey - 3 if p == ep and ey < bot_of(p) else bot_of(p)
        segs.append((p, max(ys, top_of(p)) if p != pg else ys, min(ye, bot_of(p)), x[0], x[1] or W))
    return segs


def finish_image_paper(r, doc, items, key, notes, ga_count=10):
    """items: [dict(qn, sect, segs, text, type_guess, marks_guess, rev[])] -> question dicts."""
    out = []
    for it in items:
        k = (key or {}).get(it["qn"])
        rev = list(it["rev"])
        im = render_segments(doc, it["segs"])
        image = save_img(im, r["id"], it["qn"]) if im is not None else None
        if image is None:
            rev.append("no image")
        text = it.get("text")
        if text is None:
            text = ocr_text_of_png(IMG / Path(image).name) if image else ""
        if key is not None and k is None:
            rev.append("no key row")
        qtype = k["type"] if k else it["type_guess"]
        if not k:
            rev.append("type inferred (no key)")
        marks = k["marks"] if k and k["marks"] in (1, 2) else it["marks_guess"]

        if k and k["marks"] in (1, 2) and k["marks"] != it["marks_guess"]:
            rev.append(f"key marks {k['marks']} != position rule {it['marks_guess']}")
        ans = k["answer"] if k else None
        if k and ans is None:
            rev.append("answer unparsed")
        if k and k.get("printed_mismatch"):
            rev.append("key row alignment doubtful (printed Q.No. differs from position)")
        if k and k.get("guessed"):
            rev.append("answer letter read by template matching (low-res key); verify")
        if not k:
            rev.append("answer unknown (no key)")
        out.append(make_q(r, it["qn"], it["sect"], qtype, marks, text, [], ans, image, rev, sorted({s[0] for s in it["segs"]}),
                          text_quality="ocr-see-image", qno_in_paper=it.get("qno_in_paper"),
                          key_session=k["session"] if k else None))
    return out


def rule_marks(sect, n):
    """Position rule (identical for all CS papers 2017-2026): GA 1-5 =1, 6-10 =2 ; subject 1-25 =1, 26-55 =2."""
    return (1 if n <= 5 else 2) if sect == "GA" else (1 if n <= 25 else 2)


# ---- 2017 (BYJU'S re-typeset)
def build_byjus17(r, doc):
    pages = list(range(len(doc)))
    cover = {}
    keypages = {}
    cur = None
    for p in pages:
        t = doc[p].get_text()
        m = re.search(r"session\s*(\d)", t, re.I)
        if "Question Paper Name" in t and m:
            cur = int(m.group(1))
            cover[cur] = p
        if re.match(r"\s*(Q\. No\.|\d+\s+(MCQ|NAT))", t) or (re.search(r"\bMCQ\b", t) and "Key" in t and "Marks" in t) or re.match(r"\s*\d+\s*\n(MCQ|NAT)", t):
            keypages.setdefault(cur, []).append(p)
    sn = r["set_no"]
    qpages = [p for p in pages if cover[sn] < p and (p not in keypages.get(sn, [])) and
              (sn == 2 or p < cover.get(2, 10**9)) and p not in sum(keypages.values(), [])]
    key = key_from_text_pdf(PAPERS / r["pdf"], keypages[sn])
    anchors = []
    for p in qpages:
        ws = doc[p].get_text("words")
        for i, w in enumerate(ws):
            if w[4] == "Question" and i + 1 < len(ws) and ws[i + 1][4] == "Number":
                anchors.append((p, w[1]))
    anchors.sort()
    notes = []
    if len(anchors) != 65:
        notes.append(f"found {len(anchors)} anchors, expected 65")
    H = lambda p: doc[p].rect.height
    items = []
    for i, (p, y) in enumerate(anchors):
        n = i + 1
        sect = "GA" if key.get(n, {}).get("section", "").upper() == "GA" else "subject"
        segs = segs_between(doc, anchors, i, lambda p: 0.045 * H(p), lambda p: 0.965 * H(p))
        mk = key.get(n, {}).get("marks") or rule_marks(sect, n if sect == "GA" else n)
        items.append(dict(qn=n, sect=sect, segs=segs, type_guess="MCQ", marks_guess=mk,
                          rev=[] if len(anchors) == 65 else ["anchor count mismatch"]))
    return finish_image_paper(r, doc, items, key, notes), notes, key


# ---- 2020 (text-layer anchors)
def build_layer20(r, doc):
    anchors, terms, optmarks = [], [], []
    marks_by_row = []
    H = lambda p: doc[p].rect.height
    for p in range(len(doc)):
        rows = group_rows([w[:5] for w in doc[p].get_text("words")], 3)
        for rw in rows:
            t = rw["t"]
            s = " ".join(t)
            y0 = min(w[1] for w in rw["w"])
            if len(t) >= 2 and t[0].startswith("Q.No") and re.fullmatch(r"\d+", t[1]):
                anchors.append((p, y0, int(t[1])))
            elif re.match(r"^Q\.?\s*\d+\s*-\s*Q\.?\s*\d+", s) or s.startswith("CS:"):
                terms.append((p, y0, s))
            for w in rw["w"]:
                if re.fullmatch(r"\([A-D]\)", w[4]):
                    optmarks.append((p, w[1], w[4]))
    anchors.sort()
    terms.sort()
    notes = []
    pdf = PAPERS / r["pdf"]
    key_start = len(doc) - 2
    for p in range(anchors[-1][0] + 1, len(doc)):
        if any(("Answer Key" in o["t"] or "Brochure" in o["t"]) for o in ocr_page(pdf, doc, p, dpi=100, accurate=False)):
            key_start = p
            break
    # section: GA until numbering restarts
    items, sect, prev = [], "GA", 0
    seq = []
    for i, (p, y, n) in enumerate(anchors):
        if n < prev and sect == "GA":
            sect = "subject"
        prev = n
        seq.append((p, y, n, sect))
    for i, (p, y, n, sect) in enumerate(seq):
        segs = segs_between(doc, [(a[0], a[1]) for a in seq], i, lambda p: 12, lambda p: H(p) - 12,
                            term=[(a, b) for a, b, _ in terms], last_page=key_start - 1)
        nxt = (seq[i + 1][0], seq[i + 1][1]) if i + 1 < len(seq) else (999, 0)
        has_opts = sum(1 for (pp, yy, _) in optmarks if (p, y) <= (pp, yy) < nxt) >= 2
        qno = n if sect == "GA" else n + 10
        items.append(dict(qn=qno, sect=sect, segs=segs, type_guess="MCQ" if has_opts else "NAT",
                          marks_guess=rule_marks(sect, n), rev=[], qno_in_paper=n))
    cnt = {"GA": sum(1 for s in seq if s[3] == "GA"), "subject": sum(1 for s in seq if s[3] == "subject")}
    if cnt != {"GA": 10, "subject": 55}:
        notes.append(f"anchor counts {cnt}, expected GA 10 / subject 55")
    KEYPAGES[r["id"]] = (pdf, list(range(key_start, len(doc))))
    key = key_from_grid(pdf, list(range(key_start, len(doc))),
                        {'type': (0.375, 0.445), 'key': (0.505, 0.665)})
    notes.append(f"embedded key on pages {key_start+1}-{len(doc)}: {len(key)}/65 rows parsed")
    return finish_image_paper(r, doc, items, key, notes), notes, key


# ---- 2019 (pure scan; OCR anchors)
Q_OCR = re.compile(r"^[QO0]\s*[.,]?\s*(\d{1,2})\b(?!\s*[-–_]\s*[QO0])")


def build_scan19(r, doc):
    pdf = PAPERS / r["pdf"]
    cands = []
    terms = []
    key_start = next((p for p in range(len(doc)) if any(
        o["t"].startswith("Q.No") for o in ocr_page(pdf, doc, p, dpi=150, accurate=True)[:8])), len(doc))
    for p in range(key_start):
        obs = ocr_strip(pdf, doc, p, 0.07, 0.185) + [o for o in ocr_page(pdf, doc, p, dpi=150, accurate=True)
                                                        if o["x0"] < 0.2]
        seen_y = []
        for o in obs:
            t = o["t"].strip()
            if any(abs(o["y0"] - y) < 0.012 for y in seen_y):
                continue
            seen_y.append(o["y0"])
            if t.endswith("-") or "carry" in t.lower():
                if re.match(r"^[QO0]\s*[.,]?\s*\d", t):
                    terms.append((p, o["y0"]))
                continue
            m = Q_OCR.match(t)
            if m:
                cands.append((p, o["y0"], int(m.group(1))))
    cands.sort()
    # GA part: pages whose header mentions GA ; subject numbering restarts at 1
    ga_c = [c for c in cands if c[0] <= 2]
    sub_c = [c for c in cands if c[0] >= 3]
    ga, miss_ga = seq_fix(ga_c, 1, 10)
    sub, miss_sub = seq_fix(sub_c, 1, 55)
    notes = [f"GA anchors {len(ga)}/10 missing {miss_ga}", f"subject anchors {len(sub)}/55 missing {miss_sub}"]
    H = lambda p: doc[p].rect.height
    items = []
    for sect, lst in (("GA", ga), ("subject", sub)):
        anch = [(a[0], a[1] * H(a[0])) for a in lst]
        tm = [(a, b * H(a)) for a, b in terms]
        for i, (p, y, n) in enumerate(lst):
            segs = segs_between(doc, anch, i, lambda p: 0.065 * H(p), lambda p: 0.945 * H(p), term=tm,
                                last_page=key_start - 1)
            gap = [m for m in (miss_ga if sect == "GA" else miss_sub) if m == n + 1 or (m > n and m < (lst[i + 1][2] if i + 1 < len(lst) else 999))]
            rev = (["crop also contains following question(s): %s" % gap] if gap else [])
            qno = n if sect == "GA" else n + 10
            items.append(dict(qn=qno, sect=sect, segs=segs, type_guess="MCQ", marks_guess=rule_marks(sect, n), rev=rev,
                              qno_in_paper=n))
        # missing anchors: reuse crop of the preceding question
        have = {i["qn"] for i in items}
        for m in (miss_ga if sect == "GA" else miss_sub):
            qn = m if sect == "GA" else m + 10
            prev = next((i for i in items if i["qn"] == qn - 1), None)
            if prev and qn not in have:
                items.append(dict(qn=qn, sect=sect, segs=prev["segs"], type_guess="MCQ", marks_guess=rule_marks(sect, m),
                                  rev=["anchor not found by OCR; image is shared with previous question"],
                                  qno_in_paper=m))
    items.sort(key=lambda i: i["qn"])
    KEYPAGES[r["id"]] = (pdf, list(range(key_start, len(doc))))
    key = key_from_ocr_columns(pdf, range(key_start, len(doc)),
                               {'qno': (0.15, 0.24), 'key': (0.5, 0.72), 'marks': (0.76, 0.86)})
    notes.append(f"embedded key on pages {key_start+1}-{len(doc)}: {len(key)}/65 rows parsed")
    return finish_image_paper(r, doc, items, key, notes), notes, key


# ---- 2021 (image strips, bordered tables)
def table_boxes(page):
    """Find question tables on a 2021 page via their continuous left border. Returns [(y0,y1)] in 0..1."""
    pm = page.get_pixmap(dpi=100, colorspace=pymupdf.csGRAY)
    a = np.frombuffer(pm.samples, dtype=np.uint8).reshape(pm.h, pm.w)
    dark = a < 150
    lo, hi = int(pm.w * 0.145), int(pm.w * 0.165)
    col = np.zeros(pm.h, bool)
    for x in range(lo, hi):
        c = dark[:, x]
        s = None
        for y in range(pm.h + 1):
            v = c[y] if y < pm.h else False
            if v and s is None:
                s = y
            if not v and s is not None:
                if y - s >= 30:
                    col[s:y] = True
                s = None
    runs, s, gap, e = [], None, 0, 0
    for y, v in enumerate(col):
        if v:
            if s is None:
                s = y
            gap, e = 0, y
        elif s is not None:
            gap += 1
            if gap > 6:
                if e - s > 25:
                    runs.append((s / pm.h, e / pm.h))
                s = None
    if s is not None and e - s > 25:
        runs.append((s / pm.h, e / pm.h))
    return runs


def build_box21(r, doc):
    pdf = PAPERS / r["pdf"]
    # question pages: have a "(CS, Set-n)" banner; sets are contiguous runs of such pages
    qp = []
    for p in range(len(doc)):
        obs = ocr_page(pdf, doc, p, dpi=110, accurate=False)
        if any(o["y0"] < 0.13 and re.search(r"Set\s*[-_]?\s*[12l]\b|Set-", o["t"], re.I) for o in obs) and any(
                re.search(r"Page\s*\d+\s*of", o["t"]) for o in obs if o["y0"] > 0.9):
            qp.append(p)
    runs, cur = [], []
    for p in qp:
        if cur and p != cur[-1] + 1:
            runs.append(cur)
            cur = []
        cur.append(p)
    if cur:
        runs.append(cur)
    # first page of a set has the title block instead of the usual banner/footer: prepend it when it holds a table
    for run in runs:
        pp = run[0] - 1
        if pp >= 0 and pp not in qp and table_boxes(doc[pp]) and not any(
                "Key" in o["t"] for o in ocr_page(pdf, doc, pp, dpi=110, accurate=False)[:8]):
            run.insert(0, pp)
    pages = runs[r["set_no"] - 1]
    # tables -> questions
    items_raw = []     # dict(pieces=[(p,y0,y1)])
    for p in pages:
        obs = ocr_page(pdf, doc, p, dpi=150, accurate=True)
        for (y0, y1) in table_boxes(doc[p]):
            # first-row label: OCR text in the left label cell near the top of the table
            lab = [o["t"] for o in obs if 0.14 < o["x0"] < 0.3 and y0 - 0.01 <= o["y0"] <= y0 + 0.05 and o["x1"] < 0.4]
            lab = " ".join(lab).strip()
            new = bool(re.match(r"^[QO0]", lab)) or (not lab.startswith("(") and not (y0 < 0.2 and items_raw and items_raw[-1]["pieces"][-1][2] > 0.8))
            if lab.startswith("("):
                new = False
            piece = (p, y0, y1)
            if new or not items_raw:
                items_raw.append(dict(pieces=[piece], label=lab))
            else:
                items_raw[-1]["pieces"].append(piece)
    notes = [f"pages {pages[0]+1}-{pages[-1]+1}; {len(items_raw)} tables found (expected 65)"]
    ok = len(items_raw) == 65
    items = []
    for i, it in enumerate(items_raw):
        n = i + 1
        sect = "GA" if n <= 10 else "subject"
        segs = []
        for (p, y0, y1) in it["pieces"]:
            H, W = doc[p].rect.height, doc[p].rect.width
            segs.append((p, max(y0 * H - 6, 0), min(y1 * H + 6, H), 0.12 * W, 0.88 * W))
        sn = n if sect == "GA" else n - 10
        items.append(dict(qn=n, sect=sect, segs=segs, type_guess="MCQ", marks_guess=rule_marks(sect, sn),
                          rev=[] if ok else ["table count mismatch; numbering may be shifted"], qno_in_paper=sn))
    # key
    kpages = list(range(3 * (r["set_no"] - 1), 3 * r["set_no"]))
    KEYPAGES[r["id"]] = (PAPERS / r["key"], kpages)
    key = key_from_ocr_columns(PAPERS / r["key"], kpages,
                               {'qno': (0.10, 0.19), 'type': (0.27, 0.43),
                                'key': (0.515, 0.62) if r["set_no"] == 1 else (0.53, 0.635)})
    notes.append(f"key rows parsed {len(key)}/65")
    return finish_image_paper(r, doc, items, key, notes), notes, key


# ------------------------------------------------------------------ driver
def run_paper(r):
    IMG.mkdir(parents=True, exist_ok=True)
    for f in list(IMG.glob(f"{r['id']}-q*.png")) + list(IMG.glob(f"{r['id']}-key-*.png")):   # drop stale crops
        f.unlink()
    doc = pymupdf.open(PAPERS / r["pdf"])
    notes, key = [], None
    if r["kind"] == "text":
        key = None
        if r["key"]:
            key = key_from_text_pdf(PAPERS / r["key"])
        qs, notes = build_text_paper(r, doc, key)
    elif r["kind"] == "byjus17":
        qs, notes, key = build_byjus17(r, doc)
    elif r["kind"] == "layer20":
        qs, notes, key = build_layer20(r, doc)
    elif r["kind"] == "scan19":
        qs, notes, key = build_scan19(r, doc)
    elif r["kind"] == "box21":
        qs, notes, key = build_box21(r, doc)
    if r["id"] in KEYPAGES:
        kp, pages = KEYPAGES[r["id"]]
        kd = pymupdf.open(kp)
        names = []
        for i, pg in enumerate(pages):
            name = f"{r['id']}-key-p{i + 1}.png"
            kd[pg].get_pixmap(dpi=130).save(IMG / name)
            names.append(f"img/{name}")
        notes.append(f"key pages rendered for manual check: {names}")
        for q in qs:
            q["key_images"] = names
    if key is not None:
        used = {q["q_no"] for q in qs}
        orphan = sorted(set(key) - used)
        if orphan:
            notes.append(f"key rows with no extracted question: {orphan}")
        # sanity: key type vs parsed options
    QDIR.mkdir(parents=True, exist_ok=True)
    (QDIR / f"{r['id']}.json").write_text(json.dumps(qs, ensure_ascii=False, indent=1))
    return qs, notes, key


def main(argv):
    global OCR_ENABLED
    args = [a for a in argv if not a.startswith("--")]
    if "--no-ocr" in argv:
        OCR_ENABLED = False
    summary = {}
    for r in REG:
        if args and r["id"] not in args:
            continue
        qs, notes, key = run_paper(r)
        nrev = sum(q["needs_review"] for q in qs)
        reasons = {}
        for q in qs:
            for x in q["review_reasons"]:
                reasons[x] = reasons.get(x, 0) + 1
        nimg = sum(1 for q in qs if q["image"])
        summary[r["id"]] = dict(questions=len(qs), with_key=bool(key), key_rows=len(key) if key else 0,
                                with_answer=sum(q["answer"] is not None for q in qs), images=nimg,
                                needs_review=nrev, review_reasons=reasons, notes=notes,
                                by_type={t: sum(q["q_type"] == t for q in qs) for t in sorted(TYPES)})
        print(f"{r['id']:16} q={len(qs):3} ans={summary[r['id']]['with_answer']:3} img={nimg:3} review={nrev:3} "
              f"{summary[r['id']]['by_type']} {'; '.join(notes)}", flush=True)
    QDIR.mkdir(parents=True, exist_ok=True)
    sf = QDIR / "_summary.json"
    old = json.loads(sf.read_text()) if sf.exists() else {}
    old.update(summary)
    sf.write_text(json.dumps(old, indent=1))


if __name__ == "__main__":
    main(sys.argv[1:])
