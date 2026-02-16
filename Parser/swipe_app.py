#!/usr/bin/env python3
"""
Swipe review app (sale-only, unified object cards across competitors).

Run:
  python3 swipe_app.py --host 127.0.0.1 --port 8787
Open:
  http://127.0.0.1:8787
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import sqlite3
import statistics
import threading
from dataclasses import dataclass, field
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, quote_plus, urljoin, urlparse

import requests

import robot


AREA_TOL = 3.0
HYPERLINK_RE = re.compile(r'^=HYPERLINK\("([^"]+)"\s*,', re.IGNORECASE)

SOURCE_INFO: dict[str, dict[str, str]] = {
    "knru": {"label": "KNRU", "default_deal": "sale"},
    "nordwest": {"label": "Северо-Запад", "default_deal": "sale"},
    "rest2rent": {"label": "Rest2Rent", "default_deal": "mixed"},
}
SOURCE_ORDER = ["knru", "nordwest", "rest2rent"]

RESPONDENT_OPTIONS = [
    {"id": "olya", "label": "Оля", "short": "Оля"},
    {"id": "sasha", "label": "Саша", "short": "Саша"},
    {"id": "dima", "label": "Дима", "short": "Дима"},
    {"id": "test", "label": "Тест (админ)", "short": "Тест"},
]
RESPONDENT_IDS = {x["id"] for x in RESPONDENT_OPTIONS}
CORE_RESPONDENT_IDS = {"olya", "sasha", "dima"}

RUBRIC_FILTERS: list[dict[str, str]] = [
    {"key": "all", "label": "Все объекты"},
    {"key": "npro", "label": "Спарсили с Н ПРО"},
    {"key": "rest2rent", "label": "Объекты Rest2Rent"},
    {"key": "duplicate_exact", "label": "Срочно удалить дубль"},
    {"key": "urgent_refresh", "label": "Срочно актуализировать"},
    {"key": "missing", "label": "А с хрена ли у нас нет"},
    {"key": "fresh_knru", "label": "Свежее KNRU"},
    {"key": "fresh_nordwest", "label": "Свежее Северо-Запад"},
    {"key": "ours_higher", "label": "У нас дороже"},
    {"key": "ours_lower", "label": "У нас дешевле >10%"},
    {"key": "inexact", "label": "Неточное совпадение"},
]
RUBRIC_FILTER_KEYS = {x["key"] for x in RUBRIC_FILTERS}

RUBRIC_HINTS: dict[str, str] = {
    "duplicate_exact": "у нас 2+ одинаковые продажи: одинаковый адрес и площадь",
    "urgent_refresh": "у конкурента свежее, у нас по такому же объекту только архив",
    "missing": "у 2+ конкурентов объект есть, у нас нет подтвержденной позиции",
    "fresh_missing": "объект у нас встречается, но не подтвержден как актуальная продажа",
    "ours_higher": "сравнение цен при совпадении адреса и площади",
    "ours_lower": "мы дешевле конкурента больше чем на 10%",
    "inexact": "похожий адрес найден, нужно ручное подтверждение",
}

# Шумовые слова, которые часто прилипают к адресу, но не являются названием улицы.
NON_STREET_TOKENS = {
    "пассаж",
    "бц",
    "тц",
    "трц",
    "трк",
    "бизнес",
    "центр",
    "комплекс",
    "лофт",
    "mall",
    "tower",
}


@dataclass
class Listing:
    source: str
    source_label: str
    position_global: int
    source_total: int
    page_num: int
    page_pos: int
    competitor_listing_id: str
    district: str
    address: str
    area_m2: float | None
    price_rub: float | None
    listing_url: str
    deal_type: str
    result: str
    reason: str
    has_npro: bool
    npro_note: str
    comp: dict[str, Any] | None
    street_bag: str
    fallback_key: str
    has_house: bool
    rank_norm: float


@dataclass
class OurItem:
    address: str
    deal_type: str
    status: str
    price_rub: float | None
    area_m2: float | None
    crm_url: str
    comp: dict[str, Any] | None
    street_bag: str
    fallback_key: str


@dataclass
class UnifiedObject:
    object_id: str
    listings: list[Listing] = field(default_factory=list)
    by_source: dict[str, Listing] = field(default_factory=dict)
    ref_comp: dict[str, Any] | None = None
    street_bag: str = ""
    fallback_key: str = ""
    area_values: list[float] = field(default_factory=list)

    def add(self, listing: Listing) -> None:
        self.listings.append(listing)

        cur = self.by_source.get(listing.source)
        if cur is None or listing.position_global < cur.position_global:
            self.by_source[listing.source] = listing

        if isinstance(listing.area_m2, (int, float)):
            self.area_values.append(float(listing.area_m2))

        if self.ref_comp is None and listing.comp is not None:
            self.ref_comp = dict(listing.comp)

        if not self.street_bag and listing.street_bag:
            self.street_bag = listing.street_bag
        if not self.fallback_key and listing.fallback_key:
            self.fallback_key = listing.fallback_key

    def area_ref(self) -> float | None:
        if not self.area_values:
            return None
        return float(statistics.median(self.area_values))


def source_priority(source: str) -> int:
    try:
        return SOURCE_ORDER.index(source)
    except ValueError:
        return 999


def source_from_filename(path: Path) -> str:
    name = path.name
    if name.startswith("compare_report_nordwest_"):
        return "nordwest"
    if name.startswith("compare_report_rest2rent_"):
        return "rest2rent"
    if name.startswith("compare_report_yandex_map_"):
        return "yandex_map"
    if re.match(r"^compare_report_\d{4}-\d{2}-\d{2}\.csv$", name):
        return "knru"
    return path.stem


def latest_reports(base_dir: Path) -> dict[str, Path]:
    found: dict[str, Path] = {}
    for path in base_dir.glob("compare_report*.csv"):
        src = source_from_filename(path)
        if src not in SOURCE_INFO:
            continue
        prev = found.get(src)
        if prev is None or path.stat().st_mtime > prev.stat().st_mtime:
            found[src] = path
    return found


def clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).replace("\xa0", " ").strip()
    if text.lower() == "nan":
        return ""
    return text


def parse_hyperlink(value: str | None) -> str:
    if not value:
        return ""
    text = str(value).strip()
    m = HYPERLINK_RE.match(text)
    if m:
        return m.group(1).strip()
    if text.startswith("http://") or text.startswith("https://"):
        return text
    return ""


def to_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(str(value).strip()))
    except Exception:
        return default


def to_num(value: Any) -> float | None:
    if value is None:
        return None
    s = clean_text(value)
    if not s:
        return None
    s = s.replace(" ", "").replace(",", ".")
    s = re.sub(r"[^\d\.-]", "", s)
    if not s:
        return None
    try:
        return float(s)
    except Exception:
        return None


def format_money(value: float | None) -> str:
    if not isinstance(value, (int, float)):
        return ""
    return f"{int(round(float(value))):,}".replace(",", " ")


def format_area(value: float | None) -> str:
    if not isinstance(value, (int, float)):
        return ""
    return f"{float(value):.1f}".rstrip("0").rstrip(".")


def clean_city_prefix(address: str) -> str:
    s = (address or "").replace("\xa0", " ").strip()
    if not s:
        return s
    s = re.sub(r"[‐‑‒–—−﹘﹣－]", "-", s)
    patterns = [
        r"^\s*(?:россия,\s*)?(?:г\.?\s*)?санкт(?:-|\s)?петербург(?:\s*г\.?)?\s*,\s*",
        r"^\s*(?:россия,\s*)?спб\s*,\s*",
    ]
    out = s
    for _ in range(3):
        old = out
        for p in patterns:
            out = re.sub(p, "", out, flags=re.I)
        if out == old:
            break
    return out.strip()


def sanitize_street_bag(text: str) -> str:
    tokens = []
    for tok in clean_text(text).split():
        t = tok.strip().lower()
        if not t:
            continue
        if t in NON_STREET_TOKENS:
            continue
        if len(t) <= 2 and not re.search(r"\d", t):
            # мусорные двухбуквенные хвосты, кроме числовых токенов
            continue
        tokens.append(t)
    return " ".join(tokens).strip()


def extract_listing_id(url: str) -> str:
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        tail = parsed.path.rstrip("/").split("/")[-1]
        if tail:
            return tail
    except Exception:
        pass
    return ""


def is_sale_like(deal_type: str) -> bool:
    d = robot.norm_text(deal_type or "")
    if not d:
        return False
    return "sale" in d or "продаж" in d


def is_no_deal_like(deal_type: str) -> bool:
    d = robot.norm_text(deal_type or "")
    if not d:
        return False
    return "no_deal" in d or "без сдел" in d


def extract_meta_content(html: str, prop_names: set[str]) -> str:
    for m in re.finditer(r"<meta\b[^>]*>", html, re.IGNORECASE):
        tag = m.group(0)
        attrs = dict(
            (k.lower(), v)
            for k, v in re.findall(r"(\w+)\s*=\s*['\"]([^'\"]+)['\"]", tag, re.IGNORECASE)
        )
        prop = (attrs.get("property") or attrs.get("name") or "").lower().strip()
        if prop in prop_names and attrs.get("content"):
            return attrs["content"].strip()
    return ""


IMAGE_PATH_RE = re.compile(r"\.(?:jpe?g|png|webp|gif)(?:\?.*)?$", re.I)


def is_probable_image_url(url: str | None) -> bool:
    raw = clean_text(url)
    if not raw:
        return False
    if raw.startswith("data:"):
        return False
    if raw.startswith("/"):
        return True
    parsed = urlparse(raw)
    if parsed.scheme and parsed.scheme not in ("http", "https"):
        return False
    host = (parsed.netloc or "").lower()
    if host in {"schema.org", "www.schema.org"}:
        return False
    target = raw.lower()
    if IMAGE_PATH_RE.search(target):
        return True
    path_l = (parsed.path or "").lower()
    query_l = (parsed.query or "").lower()
    if any(x in path_l for x in ("/wp-content/uploads/", "/upload/", "/uploads/", "/images/", "/img/", "/media/", "/files/")):
        return True
    if any(x in query_l for x in ("image=", "img=", "photo=", "picture=", "format=jpg", "format=jpeg", "format=png", "format=webp")):
        return True
    return False


def first_img_src(html: str) -> str:
    patterns = [
        (r"<img\b[^>]*\bdata-src\s*=\s*['\"]([^'\"]+)['\"]", False),
        (r"<img\b[^>]*\bdata-original\s*=\s*['\"]([^'\"]+)['\"]", False),
        (r"<img\b[^>]*\bsrcset\s*=\s*['\"]([^'\"]+)['\"]", True),
        (r"<img\b[^>]*\bsrc\s*=\s*['\"]([^'\"]+)['\"]", False),
    ]
    for pat, is_srcset in patterns:
        for m in re.finditer(pat, html, re.IGNORECASE):
            src = m.group(1).strip()
            if not src or src.startswith("data:"):
                continue
            if is_srcset:
                # srcset: "<url1> 1x, <url2> 2x"
                src = src.split(",")[0].strip().split(" ")[0].strip()
            if not src:
                continue
            if src.lower().endswith(".svg"):
                continue
            if IMAGE_PATH_RE.search(src):
                return src
            if is_probable_image_url(src):
                return src
    return ""


def extract_jsonld_image(html: str) -> str:
    # Достаём image из JSON-LD (часто у карточек объявлений именно там главное фото).
    script_pat = re.compile(
        r"<script[^>]+type=['\"]application/ld\+json['\"][^>]*>(.*?)</script>",
        re.IGNORECASE | re.DOTALL,
    )
    for m in script_pat.finditer(html):
        raw = m.group(1).strip()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except Exception:
            continue

        def pick_image(node: Any) -> str:
            if isinstance(node, str):
                if not node.startswith(("http://", "https://", "/")):
                    return ""
                return node if is_probable_image_url(node) else ""
            if isinstance(node, list):
                for item in node:
                    got = pick_image(item)
                    if got:
                        return got
                return ""
            if isinstance(node, dict):
                image = node.get("image")
                if image is not None:
                    got = pick_image(image)
                    if got:
                        return got
                for v in node.values():
                    got = pick_image(v)
                    if got:
                        return got
            return ""

        img = pick_image(data)
        if img:
            return img
    return ""


def fetch_photo_url(url: str, timeout: float = 12.0) -> str:
    if not url:
        return ""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        return ""

    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "ru,en;q=0.8",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=timeout)
        if resp.status_code >= 400:
            return ""
        html = resp.text
    except Exception:
        return ""

    candidates = [
        extract_meta_content(html, {"og:image", "twitter:image", "twitter:image:src"}),
        extract_jsonld_image(html),
        first_img_src(html),
    ]
    for candidate in candidates:
        if candidate:
            resolved = urljoin(url, candidate)
            if is_probable_image_url(resolved):
                return resolved
    return ""


class SwipeState:
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.lock = threading.Lock()

        self.reports = latest_reports(base_dir)
        self.source_totals_raw: dict[str, int] = {}
        self.listings: list[Listing] = self._load_sale_listings()
        (
            self.our_items,
            self.our_street_index,
            self.our_fallback_index,
        ) = self._load_our_index()

        self.objects: list[UnifiedObject] = self._build_unified_objects(self.listings)
        self.our_presence_cache: dict[str, dict[str, Any]] = {
            obj.object_id: self._summarize_our_presence(obj) for obj in self.objects
        }
        self.objects = self._sort_objects(self.objects)
        self.object_id_to_index: dict[str, int] = {
            obj.object_id: idx for idx, obj in enumerate(self.objects)
        }

        self.priority_count = sum(1 for obj in self.objects if self._object_has_top_half(obj))
        self.multi_missing_count = sum(1 for obj in self.objects if self._is_multi_missing(obj))
        self.fresh_missing_count = sum(1 for obj in self.objects if self._is_fresh_missing(obj))
        self.urgent_refresh_count = sum(1 for obj in self.objects if self._is_urgent_refresh(obj))
        self.inexact_count = sum(1 for obj in self.objects if self._is_inexact_presence(obj))
        self.ours_higher_count = sum(1 for obj in self.objects if self._is_ours_higher(obj))
        self.ours_lower_10_count = sum(1 for obj in self.objects if self._is_ours_lower_10(obj))
        self.npro_count = sum(1 for obj in self.objects if self._has_npro_source(obj))
        self.rest2rent_count = sum(1 for obj in self.objects if self._has_source(obj, "rest2rent"))

        self.cache_path = self.base_dir / "swipe_photo_cache.json"
        self.votes_path = self.base_dir / "swipe_votes_sale_union.csv"
        self.poll_db_path = self.base_dir / "swipe_poll.sqlite3"
        self.photo_cache: dict[str, str] = self._load_photo_cache()
        self.photo_blob_cache: dict[str, tuple[bytes, str]] = {}
        self.photo_blob_order: list[str] = []
        self.photo_blob_limit = 128

        self._ensure_votes_file()
        self._init_poll_db()

    def _load_sale_listings(self) -> list[Listing]:
        out: list[Listing] = []

        for source, csv_path in sorted(self.reports.items(), key=lambda x: source_priority(x[0])):
            with csv_path.open("r", encoding="utf-8", newline="") as fh:
                rows = list(csv.DictReader(fh))

            total_rows = len(rows)
            self.source_totals_raw[source] = total_rows
            default_deal = SOURCE_INFO[source]["default_deal"]

            for i, row in enumerate(rows, start=1):
                deal = clean_text(row.get("deal_type")).lower()
                if not deal:
                    deal = default_deal
                if deal != "sale":
                    continue

                pos = to_int(row.get("position_global"), i)
                page_num = to_int(row.get("page_num"), 0)
                page_pos = to_int(row.get("page_pos"), 0)

                address = clean_city_prefix(clean_text(row.get("address")) or "(без адреса)")
                district = clean_text(row.get("district")) or "Не указан"

                listing_url = parse_hyperlink(row.get("competitor_link"))
                listing_id = clean_text(row.get("competitor_listing_id")) or extract_listing_id(listing_url)

                comp = robot.extract_components(address) if address else None
                street_bag = ""
                has_house = False
                if comp:
                    comp = dict(comp)
                    raw_bag = comp.get("street_key_bag") or comp.get("street_key") or ""
                    street_bag = sanitize_street_bag(raw_bag)
                    comp["street_key_bag_clean"] = street_bag
                    has_house = comp.get("house_from") is not None

                fallback_key = robot.norm_text(address)
                area_m2 = to_num(row.get("area_m2"))
                price_rub = to_num(row.get("price_rub"))
                pro_mark = robot.norm_text(clean_text(row.get("pro_mark")))
                pro_note = clean_text(row.get("pro_note"))
                pro_note_norm = robot.norm_text(pro_note)
                has_npro = pro_mark in {"yes", "1", "true", "да"} or (
                    "npro" in pro_note_norm and "no_npro" not in pro_note_norm
                )

                total = max(1, total_rows)
                rank_norm = max(1, pos) / total

                out.append(
                    Listing(
                        source=source,
                        source_label=SOURCE_INFO[source]["label"],
                        position_global=pos,
                        source_total=total,
                        page_num=page_num,
                        page_pos=page_pos,
                        competitor_listing_id=listing_id,
                        district=district,
                        address=address,
                        area_m2=area_m2,
                        price_rub=price_rub,
                        listing_url=listing_url,
                        deal_type="sale",
                        result=clean_text(row.get("result")),
                        reason=clean_text(row.get("reason")),
                        has_npro=has_npro,
                        npro_note=pro_note,
                        comp=comp,
                        street_bag=street_bag,
                        fallback_key=fallback_key,
                        has_house=has_house,
                        rank_norm=rank_norm,
                    )
                )

        out.sort(key=lambda x: (x.rank_norm, source_priority(x.source), x.position_global))
        return out

    def _load_our_index(self) -> tuple[list[OurItem], dict[str, list[int]], dict[str, list[int]]]:
        out: list[OurItem] = []
        street_index: dict[str, list[int]] = {}
        fallback_index: dict[str, list[int]] = {}

        xml_path = self.base_dir / robot.MY_XML_FILENAME
        if not xml_path.exists():
            return out, street_index, fallback_index

        try:
            items = robot.parse_my_xml(xml_path)
        except Exception:
            return out, street_index, fallback_index

        for item in items:
            address = clean_city_prefix(clean_text(item.get("address")))
            if not address:
                continue

            deal_type = clean_text(item.get("deal_type")).lower()
            status = clean_text(item.get("status"))

            comp = robot.extract_components(address)
            street_bag = ""
            if comp:
                comp = dict(comp)
                raw_bag = comp.get("street_key_bag") or comp.get("street_key") or ""
                street_bag = sanitize_street_bag(raw_bag)
                comp["street_key_bag_clean"] = street_bag

            fallback_key = robot.norm_text(address)

            rec = OurItem(
                address=address,
                deal_type=deal_type,
                status=status,
                price_rub=to_num(item.get("price_rub")),
                area_m2=to_num(item.get("area_m2")),
                crm_url=clean_text(item.get("crm_url")),
                comp=comp,
                street_bag=street_bag,
                fallback_key=fallback_key,
            )
            out.append(rec)
            idx = len(out) - 1

            if comp is not None and comp.get("house_from") is not None and street_bag:
                street_index.setdefault(street_bag, []).append(idx)
            if fallback_key:
                fallback_index.setdefault(fallback_key, []).append(idx)

        return out, street_index, fallback_index

    def _status_bucket(self, status: str) -> str:
        norm = robot.norm_text(status or "")
        if "архив" in norm:
            return "archive"
        if "сайт" in norm:
            return "on_site"
        return "other"

    def _summarize_our_presence(self, obj: UnifiedObject) -> dict[str, Any]:
        if not self.our_items:
            return {
                "any_count": 0,
                "sale_count": 0,
                "rent_count": 0,
                "on_site_count": 0,
                "archive_count": 0,
                "other_status_count": 0,
                "uncertain_count": 0,
                "our_min_sale_price_close_area": None,
                "exact_any_count": 0,
                "exact_sale_count": 0,
                "exact_sale_on_site_count": 0,
                "exact_sale_archive_count": 0,
                "exact_non_sale_count": 0,
                "exact_sale_duplicate_count": 0,
                "has_exact_sale_duplicate": False,
                "has_exact_object": False,
                "has_exact_sale_object": False,
                "matched_items": [],
                "confirmed_eval": [],
            }

        candidate_ids: set[int] = set()
        if obj.street_bag and obj.ref_comp is not None and obj.ref_comp.get("house_from") is not None:
            candidate_ids.update(self.our_street_index.get(obj.street_bag, []))
        if obj.fallback_key:
            candidate_ids.update(self.our_fallback_index.get(obj.fallback_key, []))

        # confirmed: house + street совпали, а corp/str не "unknown" (т.е. точнее по адресу)
        confirmed: list[OurItem] = []
        uncertain: list[OurItem] = []
        matched_meta: list[tuple[OurItem, bool, float]] = []
        area_ref = obj.area_ref()

        def area_diff(rec: OurItem) -> float:
            if area_ref is None or rec.area_m2 is None:
                return 10**9
            return abs(float(rec.area_m2) - float(area_ref))

        def area_close(rec: OurItem) -> bool:
            if area_ref is None or rec.area_m2 is None:
                return False
            return abs(float(rec.area_m2) - float(area_ref)) <= AREA_TOL

        for idx in sorted(candidate_ids):
            rec = self.our_items[idx]

            # Фоллбек-совпадение по полному нормализованному адресу.
            if obj.fallback_key and rec.fallback_key and rec.fallback_key == obj.fallback_key:
                confirmed.append(rec)
                matched_meta.append((rec, True, area_diff(rec)))
                continue

            if obj.ref_comp is None or rec.comp is None:
                continue
            if obj.ref_comp.get("house_from") is None or rec.comp.get("house_from") is None:
                continue
            if not robot.houses_overlap(obj.ref_comp, rec.comp):
                continue
            corp_rel = robot.part_relation(obj.ref_comp, rec.comp, "corp")
            str_rel = robot.part_relation(obj.ref_comp, rec.comp, "str")
            if corp_rel == "mismatch":
                continue
            if str_rel == "mismatch":
                continue
            is_confirmed = corp_rel == "ok" and str_rel == "ok"
            if is_confirmed:
                confirmed.append(rec)
            else:
                uncertain.append(rec)
            matched_meta.append((rec, is_confirmed, area_diff(rec)))

        any_count = len(confirmed)
        sale_count = sum(1 for x in confirmed if is_sale_like(x.deal_type))
        rent_count = sum(1 for x in confirmed if robot.norm_text(x.deal_type) == "rent")
        on_site_count = sum(1 for x in confirmed if self._status_bucket(x.status) == "on_site")
        archive_count = sum(1 for x in confirmed if self._status_bucket(x.status) == "archive")
        other_status_count = max(0, any_count - on_site_count - archive_count)

        exact_confirmed = [x for x in confirmed if area_close(x)]
        exact_sale = [x for x in exact_confirmed if is_sale_like(x.deal_type)]
        exact_sale_on_site = [x for x in exact_sale if self._status_bucket(x.status) == "on_site"]
        exact_sale_archive = [x for x in exact_sale if self._status_bucket(x.status) == "archive"]
        exact_non_sale = [x for x in exact_confirmed if not is_sale_like(x.deal_type)]
        exact_sale_dup_map: dict[tuple[str, float], int] = {}
        for x in exact_sale:
            if not isinstance(x.area_m2, (int, float)):
                continue
            k = (robot.norm_text(x.address), round(float(x.area_m2), 2))
            exact_sale_dup_map[k] = exact_sale_dup_map.get(k, 0) + 1
        exact_sale_duplicate_count = sum(v for v in exact_sale_dup_map.values() if v > 1)

        sale_prices_close = [
            float(x.price_rub)
            for x in confirmed
            if isinstance(x.price_rub, (int, float)) and float(x.price_rub) > 0 and is_sale_like(x.deal_type)
            and area_ref is not None and x.area_m2 is not None
            and abs(float(x.area_m2) - float(area_ref)) <= AREA_TOL
        ]
        our_min_sale_price_close_area = min(sale_prices_close) if sale_prices_close else None

        confirmed_eval = []
        for rec in confirmed:
            confirmed_eval.append(
                {
                    "is_sale": is_sale_like(rec.deal_type),
                    "is_no_deal": is_no_deal_like(rec.deal_type),
                    "status_bucket": self._status_bucket(rec.status),
                    "area_m2": float(rec.area_m2) if isinstance(rec.area_m2, (int, float)) else None,
                }
            )

        # Для ручной проверки выводим top-5 наших совпадений с ссылками.
        matched_meta.sort(
            key=lambda t: (
                0 if t[1] else 1,  # confirmed first
                0 if self._status_bucket(t[0].status) == "on_site" else 1,
                t[2],
                robot.norm_text(t[0].address),
            )
        )
        seen = set()
        matched_items = []
        for rec, is_confirmed, diff in matched_meta:
            key = (rec.address, rec.deal_type, rec.status, rec.crm_url)
            if key in seen:
                continue
            seen.add(key)
            matched_items.append(
                {
                    "address": rec.address,
                    "deal_type": rec.deal_type,
                    "status": rec.status,
                    "area_m2": format_area(rec.area_m2),
                    "price_rub": format_money(rec.price_rub),
                    "crm_url": rec.crm_url,
                    "confirmed": is_confirmed,
                    "area_diff": (round(diff, 1) if diff < 10**8 else None),
                }
            )
            if len(matched_items) >= 5:
                break

        return {
            "any_count": any_count,
            "sale_count": sale_count,
            "rent_count": rent_count,
            "on_site_count": on_site_count,
            "archive_count": archive_count,
            "other_status_count": other_status_count,
            "uncertain_count": len(uncertain),
            "our_min_sale_price_close_area": our_min_sale_price_close_area,
            "exact_any_count": len(exact_confirmed),
            "exact_sale_count": len(exact_sale),
            "exact_sale_on_site_count": len(exact_sale_on_site),
            "exact_sale_archive_count": len(exact_sale_archive),
            "exact_non_sale_count": len(exact_non_sale),
            "exact_sale_duplicate_count": exact_sale_duplicate_count,
            "has_exact_sale_duplicate": any(v > 1 for v in exact_sale_dup_map.values()),
            "has_exact_object": len(exact_confirmed) > 0,
            "has_exact_sale_object": len(exact_sale) > 0,
            "matched_items": matched_items,
            "confirmed_eval": confirmed_eval,
        }

    def _is_multi_missing(self, obj: UnifiedObject) -> bool:
        presence = self.our_presence_cache.get(obj.object_id, {})
        return (
            len(obj.by_source) >= 2
            and presence.get("any_count", 0) == 0
            and presence.get("uncertain_count", 0) == 0
        )

    def _has_fresh_competitor(self, obj: UnifiedObject) -> bool:
        for l in obj.by_source.values():
            rank_pct = (l.position_global / max(1, l.source_total)) * 100.0
            if rank_pct < 10.0:
                return True
        return False

    def _is_fresh_missing(self, obj: UnifiedObject) -> bool:
        if not self._has_fresh_competitor(obj):
            return False
        if self._is_urgent_refresh(obj):
            return False
        presence = self.our_presence_cache.get(obj.object_id, {})
        any_count = presence.get("any_count", 0)
        uncertain = presence.get("uncertain_count", 0)
        # Если у нас вообще ничего нет — это классическое "а с хрена ли у нас нет".
        if any_count == 0 and uncertain == 0:
            return False
        if presence.get("exact_sale_on_site_count", 0) > 0:
            return False
        return True

    def _is_urgent_refresh(self, obj: UnifiedObject) -> bool:
        presence = self.our_presence_cache.get(obj.object_id, {})
        if presence.get("exact_sale_archive_count", 0) <= 0:
            return False
        if presence.get("exact_sale_on_site_count", 0) > 0:
            return False
        return self._has_fresh_competitor(obj)

    def _has_exact_sale_duplicate(self, obj: UnifiedObject) -> bool:
        presence = self.our_presence_cache.get(obj.object_id, {})
        return bool(presence.get("has_exact_sale_duplicate"))

    def _is_ours_higher(self, obj: UnifiedObject) -> bool:
        if len(obj.by_source) < 2:
            return False
        presence = self.our_presence_cache.get(obj.object_id, {})
        our_min_sale_price = presence.get("our_min_sale_price_close_area")
        if not isinstance(our_min_sale_price, (int, float)):
            return False
        competitor_prices = [
            float(x.price_rub)
            for x in obj.by_source.values()
            if isinstance(x.price_rub, (int, float)) and float(x.price_rub) > 0
        ]
        if not competitor_prices:
            return False
        competitor_min_price = min(competitor_prices)
        return float(our_min_sale_price) > float(competitor_min_price)

    def _is_ours_lower_10(self, obj: UnifiedObject) -> bool:
        if len(obj.by_source) < 2:
            return False
        presence = self.our_presence_cache.get(obj.object_id, {})
        our_min_sale_price = presence.get("our_min_sale_price_close_area")
        if not isinstance(our_min_sale_price, (int, float)):
            return False
        competitor_prices = [
            float(x.price_rub)
            for x in obj.by_source.values()
            if isinstance(x.price_rub, (int, float)) and float(x.price_rub) > 0
        ]
        if not competitor_prices:
            return False
        competitor_min_price = min(competitor_prices)
        if competitor_min_price <= 0:
            return False
        return float(our_min_sale_price) <= float(competitor_min_price) * 0.9

    def _is_inexact_presence(self, obj: UnifiedObject) -> bool:
        if len(obj.by_source) < 2:
            return False
        presence = self.our_presence_cache.get(obj.object_id, {})
        return presence.get("any_count", 0) == 0 and presence.get("uncertain_count", 0) > 0

    def _presence_has_area_match(
        self,
        presence: dict[str, Any],
        listing_area: float | None,
        *,
        need_sale: bool | None = None,
    ) -> bool:
        rows = presence.get("confirmed_eval") or []
        if not rows:
            return False
        for rec in rows:
            if need_sale is True and not rec.get("is_sale"):
                continue
            if need_sale is False and rec.get("is_sale"):
                continue
            area = rec.get("area_m2")
            if isinstance(listing_area, (int, float)):
                if not isinstance(area, (int, float)):
                    continue
                if abs(float(area) - float(listing_area)) > AREA_TOL:
                    continue
            return True
        return False

    def _listing_result(self, listing: Listing, presence: dict[str, Any]) -> str:
        if self._presence_has_area_match(presence, listing.area_m2, need_sale=True):
            return "Совпало"
        if self._presence_has_area_match(presence, listing.area_m2, need_sale=False):
            return "Объект есть, сделки sale нет"
        if presence.get("sale_count", 0) > 0:
            return "По адресу есть, но площадь другая"
        if presence.get("any_count", 0) > 0:
            return "Объект есть, сделки sale нет"
        if presence.get("uncertain_count", 0) > 0:
            return "Неточное совпадение"
        return "Нет у нас"

    def _source_rank_pct(self, obj: UnifiedObject, source: str) -> float | None:
        listing = obj.by_source.get(source)
        if listing is None:
            return None
        return (listing.position_global / max(1, listing.source_total)) * 100.0

    def _source_is_fresh(self, obj: UnifiedObject, source: str) -> bool:
        pct = self._source_rank_pct(obj, source)
        return pct is not None and pct < 10.0

    def _has_source(self, obj: UnifiedObject, source: str) -> bool:
        return source in obj.by_source

    def _has_npro_source(self, obj: UnifiedObject) -> bool:
        return any(bool(x.has_npro) for x in obj.by_source.values())

    def _rubric_for_object(self, obj: UnifiedObject) -> tuple[str, str, str]:
        if self._has_exact_sale_duplicate(obj):
            return (
                "СРОЧНО УДАЛИТЬ ДУБЛЬ",
                "duplicate_exact",
                RUBRIC_HINTS.get("duplicate_exact", ""),
            )
        if self._is_urgent_refresh(obj):
            return (
                "СРОЧНО АКТУАЛИЗИРОВАТЬ",
                "urgent_refresh",
                RUBRIC_HINTS.get("urgent_refresh", ""),
            )
        if self._is_ours_lower_10(obj):
            return (
                "а собственник точно непроотив",
                "ours_lower",
                RUBRIC_HINTS.get("ours_lower", ""),
            )
        if self._is_ours_higher(obj):
            return (
                "а схерали у нас дороже чем у конкурентов",
                "ours_higher",
                RUBRIC_HINTS.get("ours_higher", ""),
            )
        if self._is_fresh_missing(obj):
            return (
                "Актуализируем брат, а?",
                "fresh_missing",
                RUBRIC_HINTS.get("fresh_missing", ""),
            )
        if self._is_multi_missing(obj):
            return (
                "а с хрена ли у нас нет",
                "missing",
                RUBRIC_HINTS.get("missing", ""),
            )
        if self._is_inexact_presence(obj):
            return (
                "неточное совпадение",
                "inexact",
                RUBRIC_HINTS.get("inexact", ""),
            )
        return "", "", ""

    def _normalize_filter_key(self, key: str | None) -> str:
        k = clean_text(key).lower()
        if k not in RUBRIC_FILTER_KEYS:
            return "all"
        return k

    def _object_matches_filter(self, obj: UnifiedObject, filter_key: str) -> bool:
        fk = self._normalize_filter_key(filter_key)
        if fk == "all":
            return True
        _, rubric_class, _ = self._rubric_for_object(obj)
        if fk == "npro":
            return self._has_npro_source(obj)
        if fk == "rest2rent":
            return self._has_source(obj, "rest2rent")
        if fk == "fresh_knru":
            return self._source_is_fresh(obj, "knru")
        if fk == "fresh_nordwest":
            return self._source_is_fresh(obj, "nordwest")
        if fk == "duplicate_exact":
            return rubric_class == "duplicate_exact"
        if fk == "ours_higher":
            return rubric_class == "ours_higher"
        if fk == "ours_lower":
            return rubric_class == "ours_lower"
        if fk == "missing":
            return rubric_class == "missing"
        if fk == "inexact":
            return rubric_class == "inexact"
        if fk == "urgent_refresh":
            return rubric_class == "urgent_refresh"
        return False

    def _eligible_indices(self, filter_key: str) -> list[int]:
        fk = self._normalize_filter_key(filter_key)
        if fk == "all":
            return list(range(len(self.objects)))
        out: list[int] = []
        for idx, obj in enumerate(self.objects):
            if self._object_matches_filter(obj, fk):
                out.append(idx)
        return out

    def _filter_progress(self, respondent_id: str = "") -> dict[str, dict[str, Any]]:
        rid = clean_text(respondent_id).lower()
        voted_ids = self._voted_object_ids(rid) if rid in RESPONDENT_IDS else set()
        out: dict[str, dict[str, Any]] = {}
        for flt in RUBRIC_FILTERS:
            key = flt["key"]
            eligible = self._eligible_indices(key)
            total = len(eligible)
            answered = sum(1 for i in eligible if self.objects[i].object_id in voted_ids) if voted_ids else 0
            pending = max(0, total - answered)
            pct = round((answered / max(1, total)) * 100.0, 1)
            out[key] = {
                "total": total,
                "answered": answered,
                "pending": pending,
                "pct": pct,
            }
        return out

    def _voted_object_ids(self, respondent_id: str) -> set[str]:
        rid = clean_text(respondent_id)
        if not rid:
            return set()
        out: set[str] = set()
        with self._db_connect() as conn:
            rows = conn.execute(
                """
                SELECT object_id
                FROM respondent_vote
                WHERE respondent_id = ?
                """,
                (rid,),
            ).fetchall()
            for row in rows:
                oid = clean_text(row["object_id"])
                if oid:
                    out.add(oid)
        return out

    def _latest_vote_map(self) -> dict[tuple[str, str], dict[str, Any]]:
        latest: dict[tuple[str, str], dict[str, Any]] = {}
        with self._db_connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM respondent_vote
                ORDER BY id
                """
            ).fetchall()
            for row in rows:
                rid = clean_text(row["respondent_id"])
                oid = clean_text(row["object_id"])
                if rid not in RESPONDENT_IDS or not oid:
                    continue
                latest[(rid, oid)] = dict(row)
        return latest

    def _match_score(self, listing: Listing, obj: UnifiedObject) -> tuple[float, float, float, float]:
        same_source_penalty = 1.0 if listing.source in obj.by_source else 0.0

        corp_penalty = 0.5
        str_penalty = 0.5
        if listing.comp is not None and obj.ref_comp is not None:
            corp_rel = robot.part_relation(listing.comp, obj.ref_comp, "corp")
            str_rel = robot.part_relation(listing.comp, obj.ref_comp, "str")
            corp_penalty = 0.0 if corp_rel == "ok" else 0.3
            str_penalty = 0.0 if str_rel == "ok" else 0.3

        area_diff = 9999.0
        area_ref = obj.area_ref()
        if area_ref is not None and listing.area_m2 is not None:
            area_diff = abs(float(listing.area_m2) - float(area_ref))

        best_pos = min((x.position_global for x in obj.by_source.values()), default=10**9)
        return (same_source_penalty, area_diff, corp_penalty + str_penalty, float(best_pos))

    def _is_match(self, listing: Listing, obj: UnifiedObject) -> bool:
        if listing.street_bag and obj.street_bag and listing.street_bag == obj.street_bag:
            if listing.comp is None or obj.ref_comp is None:
                return False
            if not listing.has_house or obj.ref_comp.get("house_from") is None:
                return False
            if not robot.houses_overlap(listing.comp, obj.ref_comp):
                return False
            if robot.part_relation(listing.comp, obj.ref_comp, "corp") == "mismatch":
                return False
            if robot.part_relation(listing.comp, obj.ref_comp, "str") == "mismatch":
                return False

            area_ref = obj.area_ref()
            if area_ref is not None and listing.area_m2 is not None:
                if abs(float(listing.area_m2) - float(area_ref)) > AREA_TOL:
                    return False
            return True

        if listing.fallback_key and obj.fallback_key and listing.fallback_key == obj.fallback_key:
            area_ref = obj.area_ref()
            if area_ref is not None and listing.area_m2 is not None:
                if abs(float(listing.area_m2) - float(area_ref)) > AREA_TOL:
                    return False
            return True

        return False

    def _build_unified_objects(self, listings: list[Listing]) -> list[UnifiedObject]:
        objects: list[UnifiedObject] = []
        street_index: dict[str, list[int]] = {}
        fallback_index: dict[str, list[int]] = {}

        for listing in listings:
            candidate_ids: list[int] = []
            if listing.street_bag and listing.has_house:
                candidate_ids.extend(street_index.get(listing.street_bag, []))
            if listing.fallback_key:
                candidate_ids.extend(fallback_index.get(listing.fallback_key, []))
            candidate_ids = list(dict.fromkeys(candidate_ids))

            best_idx: int | None = None
            best_score: tuple[float, float, float, float] | None = None

            for idx in candidate_ids:
                obj = objects[idx]
                if not self._is_match(listing, obj):
                    continue
                score = self._match_score(listing, obj)
                if best_score is None or score < best_score:
                    best_idx = idx
                    best_score = score

            if best_idx is None:
                obj = UnifiedObject(object_id=f"obj_{len(objects) + 1}")
                obj.add(listing)
                objects.append(obj)
                new_idx = len(objects) - 1

                if listing.street_bag and listing.has_house:
                    street_index.setdefault(listing.street_bag, []).append(new_idx)
                if listing.fallback_key:
                    fallback_index.setdefault(listing.fallback_key, []).append(new_idx)
            else:
                objects[best_idx].add(listing)

        return objects

    def _choose_primary(self, obj: UnifiedObject) -> Listing:
        listings = list(obj.by_source.values())
        listings.sort(key=lambda x: (source_priority(x.source), x.position_global))
        return listings[0]

    def _choose_district(self, obj: UnifiedObject) -> str:
        preferred = self._choose_primary(obj).district
        if preferred and preferred.lower() != "не указан":
            return preferred
        for src in SOURCE_ORDER:
            l = obj.by_source.get(src)
            if l and l.district and l.district.lower() != "не указан":
                return l.district
        return preferred or "Не указан"

    def _object_has_top_half(self, obj: UnifiedObject) -> bool:
        for l in obj.by_source.values():
            if l.position_global <= max(1, int(round(l.source_total * 0.5))):
                return True
        return False

    def _sort_objects(self, objects: list[UnifiedObject]) -> list[UnifiedObject]:
        def key(obj: UnifiedObject):
            in_top = self._object_has_top_half(obj)
            source_count = len(obj.by_source)
            ranks = [x.rank_norm for x in obj.by_source.values()]
            best_rank = min(ranks) if ranks else 10**9
            best_pos = min((x.position_global for x in obj.by_source.values()), default=10**9)

            our_any = self.our_presence_cache.get(obj.object_id, {}).get("any_count", 0)
            uncertain = self.our_presence_cache.get(obj.object_id, {}).get("uncertain_count", 0)
            if self._is_urgent_refresh(obj):
                bucket = 0
            elif self._is_fresh_missing(obj):
                bucket = 1
            elif source_count >= 2 and our_any == 0 and uncertain == 0:
                bucket = 2
            elif source_count >= 2 and our_any == 0 and uncertain > 0:
                bucket = 3
            elif self._is_ours_higher(obj):
                bucket = 4
            elif self._is_ours_lower_10(obj):
                bucket = 5
            elif source_count >= 2:
                bucket = 6
            elif in_top:
                bucket = 7
            else:
                bucket = 8

            primary = self._choose_primary(obj)
            district = robot.norm_text(self._choose_district(obj))
            address = robot.norm_text(primary.address)

            return (
                bucket,
                -source_count,
                best_rank,
                best_pos,
                district,
                address,
            )

        return sorted(objects, key=key)

    def _load_photo_cache(self) -> dict[str, str]:
        if not self.cache_path.exists():
            return {}
        try:
            data = json.loads(self.cache_path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                out: dict[str, str] = {}
                for k, v in data.items():
                    key = str(k)
                    val = str(v)
                    if val and not is_probable_image_url(val):
                        continue
                    out[key] = val
                return out
        except Exception:
            pass
        return {}

    def _save_photo_cache(self) -> None:
        tmp = self.cache_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.photo_cache, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.cache_path)

    def _db_connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.poll_db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_poll_db(self) -> None:
        with self._db_connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS respondent_session (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    respondent_id TEXT NOT NULL,
                    respondent_label TEXT NOT NULL,
                    started_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS respondent_vote (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id INTEGER,
                    respondent_id TEXT,
                    object_id TEXT,
                    object_index INTEGER,
                    vote TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    address TEXT,
                    district TEXT,
                    area_m2 REAL,
                    price_rub REAL,
                    rubric TEXT,
                    rubric_class TEXT,
                    suggestion_text TEXT
                )
                """
            )
            # Миграции старой локальной БД.
            cols = {
                str(r["name"])
                for r in conn.execute("PRAGMA table_info(respondent_vote)").fetchall()
            }
            alter_defs = [
                ("object_index", "INTEGER"),
                ("address", "TEXT"),
                ("district", "TEXT"),
                ("area_m2", "REAL"),
                ("price_rub", "REAL"),
                ("rubric", "TEXT"),
                ("rubric_class", "TEXT"),
                ("suggestion_text", "TEXT"),
            ]
            for col_name, col_type in alter_defs:
                if col_name not in cols:
                    conn.execute(
                        f"ALTER TABLE respondent_vote ADD COLUMN {col_name} {col_type}"  # noqa: S608
                    )
            conn.commit()

    def _ensure_votes_file(self) -> None:
        expected_header = [
            "timestamp",
            "session_id",
            "respondent_id",
            "respondent_label",
            "index",
            "object_id",
            "address",
            "district",
            "area_m2",
            "price_rub",
            "sources",
            "vote",
            "suggestion_text",
            "rubric",
            "rubric_class",
        ]
        if self.votes_path.exists():
            try:
                with self.votes_path.open("r", encoding="utf-8", newline="") as fh:
                    head = next(csv.reader(fh), [])
                if head == expected_header:
                    return
            except Exception:
                pass
            backup = self.votes_path.with_suffix(".bak.csv")
            try:
                self.votes_path.replace(backup)
            except Exception:
                pass

        with self.votes_path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(expected_header)

    def _reset_votes_file(self) -> None:
        with self.votes_path.open("w", encoding="utf-8", newline="") as fh:
            writer = csv.writer(fh)
            writer.writerow(
                [
                    "timestamp",
                    "session_id",
                    "respondent_id",
                    "respondent_label",
                    "index",
                    "object_id",
                    "address",
                    "district",
                    "area_m2",
                    "price_rub",
                    "sources",
                    "vote",
                    "suggestion_text",
                    "rubric",
                    "rubric_class",
                ]
            )

    def clear_all_votes(self, requested_by: str) -> dict[str, Any]:
        rid = clean_text(requested_by).lower()
        if rid != "test":
            raise ValueError("not_allowed")
        with self._db_connect() as conn:
            conn.execute("DELETE FROM respondent_vote")
            conn.commit()
        self._reset_votes_file()
        return {"ok": True}

    def _pick_photo(self, obj: UnifiedObject) -> str:
        candidates = sorted(
            [x for x in obj.by_source.values() if x.listing_url],
            key=lambda x: (source_priority(x.source), x.position_global),
        )

        for listing in candidates:
            url = listing.listing_url
            cached = self.photo_cache.get(url)
            if cached and is_probable_image_url(cached):
                return cached
            if cached is not None and not cached:
                # Пустые значения не держим как финальные: сеть/защита могли временно помешать.
                self.photo_cache.pop(url, None)
                self._save_photo_cache()
            if cached and not is_probable_image_url(cached):
                self.photo_cache.pop(url, None)
                self._save_photo_cache()

            photo = fetch_photo_url(url)
            if photo:
                self.photo_cache[url] = photo
                self._save_photo_cache()
                return photo

        return ""

    def get_photo_blob(self, src_url: str) -> tuple[bytes, str] | None:
        src_url = clean_text(src_url)
        parsed = urlparse(src_url)
        if parsed.scheme not in ("http", "https"):
            return None

        cached = self.photo_blob_cache.get(src_url)
        if cached is not None:
            return cached

        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Referer": f"{parsed.scheme}://{parsed.netloc}/",
        }
        try:
            resp = requests.get(src_url, headers=headers, timeout=18)
        except Exception:
            return None
        if resp.status_code >= 400:
            return None

        data = resp.content or b""
        if len(data) < 64:
            return None
        content_type = (resp.headers.get("Content-Type") or "image/jpeg").split(";")[0].strip()
        blob = (data, content_type)

        self.photo_blob_cache[src_url] = blob
        self.photo_blob_order.append(src_url)
        if len(self.photo_blob_order) > self.photo_blob_limit:
            old = self.photo_blob_order.pop(0)
            self.photo_blob_cache.pop(old, None)
        return blob

    def poll_summary(self) -> dict[str, Any]:
        all_ids = [x["id"] for x in RESPONDENT_OPTIONS if x["id"] in CORE_RESPONDENT_IDS]
        today_ids: set[str] = set()
        with self._db_connect() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT respondent_id
                FROM respondent_session
                WHERE DATE(started_at) = DATE('now', 'localtime')
                """
            ).fetchall()
            for r in rows:
                rid = clean_text(r["respondent_id"])
                if rid and rid in all_ids:
                    today_ids.add(rid)

        missing_ids = [x for x in all_ids if x not in today_ids]
        id_to_short = {x["id"]: x["short"] for x in RESPONDENT_OPTIONS}
        id_to_label = {x["id"]: x["label"] for x in RESPONDENT_OPTIONS}
        return {
            "responded_ids": sorted(today_ids),
            "responded_names": [id_to_short.get(x, x) for x in sorted(today_ids)],
            "missing_ids": missing_ids,
            "missing_names": [id_to_short.get(x, x) for x in missing_ids],
            "responded_labels": [id_to_label.get(x, x) for x in sorted(today_ids)],
        }

    def poll_options(self) -> dict[str, Any]:
        return {"options": RESPONDENT_OPTIONS, "summary": self.poll_summary()}

    def start_session(self, respondent_id: str) -> dict[str, Any]:
        rid = clean_text(respondent_id)
        opt = next((x for x in RESPONDENT_OPTIONS if x["id"] == rid), None)
        if opt is None:
            raise ValueError("unknown respondent")
        now = datetime.now().isoformat(timespec="seconds")
        with self._db_connect() as conn:
            cur = conn.execute(
                """
                INSERT INTO respondent_session (respondent_id, respondent_label, started_at)
                VALUES (?, ?, ?)
                """,
                (opt["id"], opt["short"], now),
            )
            conn.commit()
            sid = int(cur.lastrowid)
        out = {"session_id": sid, "respondent_id": opt["id"], "respondent_label": opt["short"]}
        out["summary"] = self.poll_summary()
        return out

    def meta(self, respondent_id: str = "") -> dict[str, Any]:
        progress = self._filter_progress(respondent_id)
        filters = []
        for flt in RUBRIC_FILTERS:
            key = flt["key"]
            p = progress.get(key, {})
            filters.append(
                {
                    "key": key,
                    "label": flt["label"],
                    "count": p.get("total", 0),
                    "answered": p.get("answered", 0),
                    "pending": p.get("pending", 0),
                    "pct": p.get("pct", 0.0),
                }
            )
        return {
            "total_objects": len(self.objects),
            "priority_objects": self.priority_count,
            "tail_objects": len(self.objects) - self.priority_count,
            "multi_missing_objects": self.multi_missing_count,
            "fresh_missing_objects": self.fresh_missing_count,
            "urgent_refresh_objects": self.urgent_refresh_count,
            "inexact_objects": self.inexact_count,
            "ours_higher_objects": self.ours_higher_count,
            "ours_lower_10_objects": self.ours_lower_10_count,
            "duplicate_exact_objects": sum(1 for obj in self.objects if self._has_exact_sale_duplicate(obj)),
            "npro_objects": self.npro_count,
            "rest2rent_objects": self.rest2rent_count,
            "source_rows": {
                SOURCE_INFO.get(src, {}).get("label", src): self.source_totals_raw.get(src, 0)
                for src in SOURCE_ORDER
                if src in self.source_totals_raw
            },
            "filters": filters,
            "poll": self.poll_summary(),
        }

    def get_card(
        self,
        index: int,
        respondent_id: str = "",
        rubric_filter: str = "all",
        object_id: str = "",
    ) -> dict[str, Any]:
        rid = clean_text(respondent_id).lower()
        if rid not in RESPONDENT_IDS:
            rid = ""
        filter_key = self._normalize_filter_key(rubric_filter)
        eligible_indices = self._eligible_indices(filter_key)
        total_eligible = len(eligible_indices)

        forced_object_id = clean_text(object_id)
        if forced_object_id:
            obj_index = self.object_id_to_index.get(forced_object_id)
            if obj_index is None:
                return {
                    "done": True,
                    "index": index,
                    "total": total_eligible,
                    "filter": filter_key,
                    "reason": "object_not_found",
                }
            display_index = eligible_indices.index(obj_index) if obj_index in eligible_indices else 0
            total_for_progress = total_eligible if total_eligible > 0 else len(self.objects)
        else:
            if total_eligible <= 0:
                return {
                    "done": True,
                    "index": 0,
                    "total": 0,
                    "filter": filter_key,
                    "reason": "no_objects_for_filter",
                }
            start = max(0, int(index))
            voted_ids = self._voted_object_ids(rid) if rid else set()
            obj_index = None
            display_index = start
            for pos in range(start, total_eligible):
                cand_idx = eligible_indices[pos]
                if rid and self.objects[cand_idx].object_id in voted_ids:
                    continue
                obj_index = cand_idx
                display_index = pos
                break
            if obj_index is None:
                return {
                    "done": True,
                    "index": start,
                    "total": total_eligible,
                    "filter": filter_key,
                    "reason": "all_answered_for_filter",
                }
            total_for_progress = total_eligible

        obj = self.objects[obj_index]
        primary = self._choose_primary(obj)
        district = self._choose_district(obj)
        photo_src = self._pick_photo(obj)
        photo_url = f"/api/photo?src={quote_plus(photo_src)}" if photo_src else ""
        area_ref = obj.area_ref()
        our_presence = self.our_presence_cache.get(
            obj.object_id,
            {
                "any_count": 0,
                "sale_count": 0,
                "rent_count": 0,
                "on_site_count": 0,
                "archive_count": 0,
                "other_status_count": 0,
                "uncertain_count": 0,
                "our_min_sale_price_close_area": None,
                "exact_any_count": 0,
                "exact_sale_count": 0,
                "exact_sale_on_site_count": 0,
                "exact_sale_archive_count": 0,
                "exact_non_sale_count": 0,
                "exact_sale_duplicate_count": 0,
                "has_exact_sale_duplicate": False,
                "has_exact_object": False,
                "has_exact_sale_object": False,
                "matched_items": [],
                "confirmed_eval": [],
            },
        )
        competitor_prices = [
            float(x.price_rub)
            for x in obj.by_source.values()
            if isinstance(x.price_rub, (int, float)) and float(x.price_rub) > 0
        ]
        competitor_min_price = min(competitor_prices) if competitor_prices else None
        our_min_sale_price = our_presence.get("our_min_sale_price_close_area")
        rubric, rubric_class, rubric_hint = self._rubric_for_object(obj)

        price_gap = None
        if (
            isinstance(our_min_sale_price, (int, float))
            and isinstance(competitor_min_price, (int, float))
        ):
            diff = float(our_min_sale_price) - float(competitor_min_price)
            diff_pct = 0.0
            if float(competitor_min_price) > 0:
                diff_pct = (diff / float(competitor_min_price)) * 100.0
            price_gap = {
                "our_min_sale_price": format_money(float(our_min_sale_price)),
                "competitor_min_price": format_money(float(competitor_min_price)),
                "diff_rub": format_money(abs(diff)),
                "diff_pct": f"{abs(diff_pct):.1f}",
                "direction": "ours_higher" if diff > 0 else ("ours_lower" if diff < 0 else "equal"),
            }

        competitors = []
        comparison_rows = []
        for src in SOURCE_ORDER:
            listing = obj.by_source.get(src)
            if listing is None:
                continue
            pos = listing.position_global
            total = listing.source_total
            rank_pct = round((pos / max(1, total)) * 100.0, 1)
            freshness = "normal"
            freshness_text = "средняя актуальность"
            if rank_pct < 10:
                freshness = "fresh"
                freshness_text = "свежее объявление"
            elif rank_pct > 50:
                freshness = "stale"
                freshness_text = "старое объявление"

            competitors.append(
                {
                    "source": src,
                    "label": listing.source_label,
                    "position_global": pos,
                    "source_total": total,
                    "rank_pct": rank_pct,
                    "top_half": rank_pct <= 50.0,
                    "freshness": freshness,
                    "freshness_text": freshness_text,
                    "area_m2": format_area(listing.area_m2),
                    "price_rub": format_money(listing.price_rub),
                    "listing_url": listing.listing_url,
                    "result": listing.result,
                    "has_npro": bool(listing.has_npro),
                    "npro_note": clean_text(listing.npro_note),
                }
            )
            accuracy_text = self._listing_result(listing, our_presence)
            if listing.has_npro:
                accuracy_text = "Спарсили с Н ПРО" if accuracy_text == "Совпало" else f"{accuracy_text} · Спарсили с Н ПРО"
            comparison_rows.append(
                {
                    "row_type": "competitor",
                    "source_label": listing.source_label,
                    "pos_or_status": f"#{pos}/{total} ({rank_pct}%)",
                    "status_text": freshness_text,
                    "status_class": freshness,
                    "area_m2": format_area(listing.area_m2),
                    "price_rub": format_money(listing.price_rub),
                    "accuracy": accuracy_text,
                    "link_url": listing.listing_url,
                    "link_label": "открыть",
                }
            )

        for item in our_presence.get("matched_items", []):
            comparison_rows.append(
                {
                    "row_type": "our",
                    "source_label": "Наша база",
                    "pos_or_status": f"{item.get('deal_type', '')} / {item.get('status', '')}",
                    "status_text": "точное совпадение" if item.get("confirmed") else "неточное совпадение",
                    "status_class": "our",
                    "area_m2": clean_text(item.get("area_m2")),
                    "price_rub": clean_text(item.get("price_rub")),
                    "accuracy": "точно" if item.get("confirmed") else "возможно",
                    "link_url": clean_text(item.get("crm_url")),
                    "link_label": "наша ссылка",
                }
            )

        inexact_note = ""
        if our_presence.get("any_count", 0) == 0 and our_presence.get("uncertain_count", 0) > 0:
            statuses = []
            for item in our_presence.get("matched_items", []):
                if item.get("confirmed"):
                    continue
                s = f"{item.get('deal_type', '')} / {item.get('status', '')}".strip(" /")
                if s and s not in statuses:
                    statuses.append(s)
            statuses_text = ", ".join(statuses) if statuses else "статус не определен"
            inexact_note = f"Неточное совпадение: найдены похожие сделки у нас ({statuses_text})"

        card = {
            "object_id": obj.object_id,
            "address": primary.address,
            "district": district,
            "deal_type": "sale",
            "area_m2_ref": format_area(area_ref),
            "competitor_min_price": format_money(competitor_min_price),
            "photo_url": photo_url,
            "panorama_url": f"https://yandex.ru/maps/?mode=search&text={quote_plus(primary.address)}",
            "source_count": len(obj.by_source),
            "top_half_object": self._object_has_top_half(obj),
            "our_presence": our_presence,
            "rubric": rubric,
            "rubric_class": rubric_class,
            "rubric_hint": rubric_hint,
            "price_gap": price_gap,
            "inexact_note": inexact_note,
            "comparison_rows": comparison_rows,
            "competitors": competitors,
            "notes": primary.reason,
            "has_npro": any(bool(x.get("has_npro")) for x in competitors),
            "npro_sources": [x["label"] for x in competitors if x.get("has_npro")],
            "show_recheck_button": (
                not bool(our_presence.get("has_exact_object"))
                and rubric_class in {"missing", "inexact"}
            ),
        }

        return {
            "done": False,
            "index": display_index,
            "total": total_for_progress,
            "filter": filter_key,
            "card": card,
        }

    def save_vote(
        self,
        index: int,
        vote: str,
        session_id: int | None,
        respondent_id: str | None,
        object_id: str | None = None,
        suggestion_text: str | None = None,
    ) -> dict[str, Any]:
        if vote not in ("left", "right", "recheck", "suggest"):
            raise ValueError("invalid vote")
        rid = clean_text(respondent_id).lower()
        if rid not in RESPONDENT_IDS:
            raise ValueError("invalid respondent")

        obj_index: int | None = None
        oid = clean_text(object_id)
        if oid:
            obj_index = self.object_id_to_index.get(oid)
        if obj_index is None:
            if index < 0 or index >= len(self.objects):
                raise IndexError("index out of range")
            obj_index = index

        obj = self.objects[obj_index]
        oid = obj.object_id
        primary = self._choose_primary(obj)
        district = self._choose_district(obj)
        area_ref = obj.area_ref()
        competitor_prices = [
            float(x.price_rub)
            for x in obj.by_source.values()
            if isinstance(x.price_rub, (int, float)) and float(x.price_rub) > 0
        ]
        competitor_min_price = min(competitor_prices) if competitor_prices else None
        _, rubric_class, _ = self._rubric_for_object(obj)
        rubric = next((x["label"] for x in RUBRIC_FILTERS if x["key"] == rubric_class), "")
        sources = "|".join(
            f"{x.source_label}#{x.position_global}/{x.source_total}"
            for x in sorted(obj.by_source.values(), key=lambda y: (source_priority(y.source), y.position_global))
        )

        now = datetime.now().isoformat(timespec="seconds")
        suggestion = clean_text(suggestion_text)
        if vote != "suggest":
            suggestion = ""
        if vote == "suggest" and not suggestion:
            suggestion = "без текста"
        sid = int(session_id) if isinstance(session_id, int) else None
        respondent_label = ""
        opt = next((x for x in RESPONDENT_OPTIONS if x["id"] == rid), None)
        if opt:
            respondent_label = opt["short"]

        with self._db_connect() as conn:
            existing = conn.execute(
                """
                SELECT id
                FROM respondent_vote
                WHERE respondent_id = ? AND object_id = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (rid, oid),
            ).fetchone()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO respondent_vote (
                        session_id, respondent_id, object_id, object_index, vote, created_at,
                        address, district, area_m2, price_rub, rubric, rubric_class, suggestion_text
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        sid,
                        rid,
                        oid,
                        obj_index,
                        vote,
                        now,
                        primary.address,
                        district,
                        float(area_ref) if isinstance(area_ref, (int, float)) else None,
                        float(competitor_min_price) if isinstance(competitor_min_price, (int, float)) else None,
                        rubric,
                        rubric_class,
                        suggestion,
                    ),
                )
            else:
                conn.execute(
                    """
                    UPDATE respondent_vote
                    SET
                        session_id = ?,
                        vote = ?,
                        created_at = ?,
                        object_index = ?,
                        address = ?,
                        district = ?,
                        area_m2 = ?,
                        price_rub = ?,
                        rubric = ?,
                        rubric_class = ?,
                        suggestion_text = ?
                    WHERE id = ?
                    """,
                    (
                        sid,
                        vote,
                        now,
                        obj_index,
                        primary.address,
                        district,
                        float(area_ref) if isinstance(area_ref, (int, float)) else None,
                        float(competitor_min_price) if isinstance(competitor_min_price, (int, float)) else None,
                        rubric,
                        rubric_class,
                        suggestion,
                        int(existing["id"]),
                    ),
                )
            conn.commit()

        with self.lock:
            with self.votes_path.open("a", encoding="utf-8", newline="") as fh:
                writer = csv.writer(fh)
                writer.writerow(
                    [
                        now,
                        sid or "",
                        rid,
                        respondent_label,
                        index,
                        oid,
                        primary.address,
                        district,
                        format_area(area_ref),
                        format_money(competitor_min_price),
                        sources,
                        vote,
                        suggestion,
                        rubric,
                        rubric_class,
                    ]
                )

        return {"ok": True, "next_index": index + 1}

    def stats(self, respondent_id: str = "", rubric_filter: str = "all") -> dict[str, Any]:
        rid = clean_text(respondent_id).lower()
        if rid not in RESPONDENT_IDS:
            rid = ""
        filter_key = self._normalize_filter_key(rubric_filter)
        eligible_indices = self._eligible_indices(filter_key)
        eligible_ids = {self.objects[i].object_id for i in eligible_indices}

        latest = self._latest_vote_map()
        counts = {"left": 0, "right": 0, "recheck": 0, "suggest": 0}
        per_person: dict[str, dict[str, Any]] = {
            x["id"]: {
                "id": x["id"],
                "label": x["short"],
                "answered": 0,
                "pending": len(eligible_ids),
                "left": 0,
                "right": 0,
                "recheck": 0,
                "suggest": 0,
                "pct": 0.0,
            }
            for x in RESPONDENT_OPTIONS
        }

        object_votes: dict[str, dict[str, str]] = {}
        for (vrid, oid), row in latest.items():
            if oid not in eligible_ids:
                continue
            vv = clean_text(row.get("vote"))
            if vv in counts:
                counts[vv] += 1
            person = per_person.get(vrid)
            if person:
                person["answered"] += 1
                if vv in ("left", "right", "recheck", "suggest"):
                    person[vv] += 1
            object_votes.setdefault(oid, {})[vrid] = vv

        for item in per_person.values():
            item["pending"] = max(0, len(eligible_ids) - item["answered"])
            item["pct"] = round((item["answered"] / max(1, len(eligible_ids))) * 100.0, 1)

        consensus_all = 0.0
        consensus_cnt = 0
        consensus_full_3 = 0
        consensus_full_3_total = 0
        for _oid, rv in object_votes.items():
            votes = [
                v
                for who, v in rv.items()
                if who in CORE_RESPONDENT_IDS and v in ("left", "right", "recheck", "suggest")
            ]
            if len(votes) < 2:
                continue
            consensus_cnt += 1
            best = max(
                votes.count("left"),
                votes.count("right"),
                votes.count("recheck"),
                votes.count("suggest"),
            )
            consensus_all += (best / len(votes)) * 100.0
            if len(votes) == 3:
                consensus_full_3_total += 1
                if best == 3:
                    consensus_full_3 += 1

        cur = per_person.get(rid) if rid else None
        current_answered = cur["answered"] if cur else 0
        current_pending = cur["pending"] if cur else len(eligible_ids)
        current_pct = cur["pct"] if cur else 0.0

        return {
            "left": counts["left"],
            "right": counts["right"],
            "recheck": counts["recheck"],
            "suggest": counts["suggest"],
            "total": counts["left"] + counts["right"] + counts["recheck"] + counts["suggest"],
            "filter": filter_key,
            "filter_total": len(eligible_ids),
            "current_respondent_id": rid,
            "current_answered": current_answered,
            "current_pending": current_pending,
            "current_pct": current_pct,
            "people": [per_person[x["id"]] for x in RESPONDENT_OPTIONS if x["id"] in CORE_RESPONDENT_IDS],
            "consensus_avg_pct": round(consensus_all / max(1, consensus_cnt), 1),
            "consensus_objects": consensus_cnt,
            "consensus_full_3": consensus_full_3,
            "consensus_full_3_total": consensus_full_3_total,
            "consensus_full_3_pct": round(
                (consensus_full_3 / max(1, consensus_full_3_total)) * 100.0, 1
            ),
        }

    def votes_history(self, limit: int = 5000) -> list[dict[str, str]]:
        latest = self._latest_vote_map()
        object_votes: dict[str, dict[str, str]] = {}
        for (vrid, oid), row in latest.items():
            vv = clean_text(row.get("vote"))
            if vv in ("left", "right", "recheck", "suggest"):
                object_votes.setdefault(oid, {})[vrid] = vv

        consensus: dict[str, dict[str, Any]] = {}
        for oid, rv in object_votes.items():
            votes = [v for who, v in rv.items() if who in CORE_RESPONDENT_IDS]
            if not votes:
                continue
            best = max(
                votes.count("left"),
                votes.count("right"),
                votes.count("recheck"),
                votes.count("suggest"),
            )
            consensus[oid] = {
                "pct": round((best / max(1, len(votes))) * 100.0, 1),
                "voters": len(votes),
            }

        rows: list[dict[str, str]] = []
        id_to_short = {x["id"]: x["short"] for x in RESPONDENT_OPTIONS}
        for (rid, oid), row in latest.items():
            obj_idx = self.object_id_to_index.get(oid)
            address = clean_text(row.get("address"))
            district = clean_text(row.get("district"))
            sources = ""
            if obj_idx is not None:
                obj = self.objects[obj_idx]
                if not address:
                    address = self._choose_primary(obj).address
                if not district:
                    district = self._choose_district(obj)
                sources = "|".join(
                    f"{x.source_label}#{x.position_global}/{x.source_total}"
                    for x in sorted(
                        obj.by_source.values(),
                        key=lambda y: (source_priority(y.source), y.position_global),
                    )
                )

            area_txt = format_area(to_num(row.get("area_m2")))
            price_txt = format_money(to_num(row.get("price_rub")))
            con = consensus.get(oid, {"pct": 0.0, "voters": 0})
            rows.append(
                {
                    "timestamp": clean_text(row.get("created_at")),
                    "respondent_id": rid,
                    "respondent_label": id_to_short.get(rid, clean_text(row.get("respondent_id"))),
                    "object_id": oid,
                    "object_index": str(to_int(row.get("object_index"), -1)),
                    "address": address,
                    "district": district,
                    "area_m2": area_txt,
                    "price_rub": price_txt,
                    "sources": sources,
                    "vote": clean_text(row.get("vote")),
                    "suggestion_text": clean_text(row.get("suggestion_text")),
                    "rubric": clean_text(row.get("rubric")),
                    "rubric_class": clean_text(row.get("rubric_class")),
                    "consensus_pct": str(con.get("pct", 0.0)),
                    "consensus_voters": str(con.get("voters", 0)),
                }
            )

        rows.sort(key=lambda x: x.get("timestamp", ""), reverse=True)
        if limit > 0:
            rows = rows[:limit]
        return rows


def _vote_label(vote: str) -> str:
    if vote == "left":
        return "ай херня"
    if vote == "right":
        return "о нормально"
    if vote == "recheck":
        return "перепроверь"
    if vote == "suggest":
        return "предложение"
    return vote


def build_votes_html(rows: list[dict[str, str]]) -> str:
    respondent_order = [x["short"] for x in RESPONDENT_OPTIONS]
    vote_defs = [
        ("right", "О НОРМАЛЬНО", "ok"),
        ("suggest", "ПРЕДЛОЖЕНИЯ", "suggest"),
        ("recheck", "ПЕРЕПРОВЕРЬ", "recheck"),
        ("left", "АЙ ХЕРНЯ", "bad"),
    ]
    grouped: dict[str, dict[str, list[dict[str, str]]]] = {
        code: {name: [] for name in respondent_order} for code, _, _ in vote_defs
    }
    totals: dict[str, int] = {code: 0 for code, _, _ in vote_defs}
    for row in rows:
        vote = clean_text(row.get("vote"))
        if vote not in grouped:
            continue
        who = clean_text(row.get("respondent_label"))
        if who not in respondent_order:
            continue
        grouped[vote][who].append(row)
        totals[vote] = totals.get(vote, 0) + 1

    consensus_by_object: dict[str, tuple[float, int]] = {}
    for row in rows:
        oid = clean_text(row.get("object_id"))
        if not oid:
            continue
        pct = to_num(row.get("consensus_pct"))
        voters = to_int(row.get("consensus_voters"), 0)
        if pct is None:
            pct = 0.0
        if voters < 0:
            voters = 0
        consensus_by_object[oid] = (float(pct), int(voters))

    agree3_total = sum(1 for _oid, (_pct, voters) in consensus_by_object.items() if voters >= 3)
    agree3_full = sum(
        1
        for _oid, (pct, voters) in consensus_by_object.items()
        if voters >= 3 and float(pct) >= 99.9
    )
    agree3_pct = round((agree3_full / max(1, agree3_total)) * 100.0, 1)

    board_cols = []
    for vote_code, vote_title, vote_class in vote_defs:
        blocks = []
        for who in respondent_order:
            items = grouped[vote_code].get(who, [])
            item_rows = []
            for x in items[:40]:
                rid = clean_text(x.get("respondent_id"))
                oid = clean_text(x.get("object_id"))
                edit_url = "/"
                if rid and oid:
                    edit_url = f"/?respondent_id={quote_plus(rid)}&object_id={quote_plus(oid)}&edit=1"
                area = clean_text(x.get("area_m2"))
                price = clean_text(x.get("price_rub"))
                area_part = f"{html.escape(area)} м²" if area else "пл. -"
                price_part = f"{html.escape(price)} ₽" if price else "цена -"
                con_pct = clean_text(x.get("consensus_pct")) or "0"
                con_voters = clean_text(x.get("consensus_voters")) or "0"
                suggestion = clean_text(x.get("suggestion_text"))
                suggestion_line = f"<div class='meta'>идея: {html.escape(suggestion)}</div>" if suggestion else ""
                item_rows.append(
                    "<li>"
                    f"<div class='addr'><a class='addr-link' href='{html.escape(edit_url)}'>{html.escape(x.get('address', ''))}</a></div>"
                    f"<div class='meta'>{html.escape(x.get('district', ''))} · {area_part} · {price_part}</div>"
                    f"{suggestion_line}"
                    f"<div class='meta'>совпадение ответов: {html.escape(con_pct)}% ({html.escape(con_voters)}/3) · {html.escape(x.get('timestamp', ''))}</div>"
                    "</li>"
                )
            if not item_rows:
                item_rows = ["<li class='empty'>—</li>"]
            blocks.append(
                "<div class='who'>"
                f"<div class='who-title'>{html.escape(who)} · {len(items)}</div>"
                f"<ul>{''.join(item_rows)}</ul>"
                "</div>"
            )
        board_cols.append(
            "<div class='vote-col "
            + vote_class
            + "'>"
            + f"<div class='vote-title'>{html.escape(vote_title)} · {totals.get(vote_code, 0)}</div>"
            + "".join(blocks)
            + "</div>"
        )

    body_rows = []
    for row in rows:
        rid = clean_text(row.get("respondent_id"))
        oid = clean_text(row.get("object_id"))
        edit_url = "/"
        if rid and oid:
            edit_url = f"/?respondent_id={quote_plus(rid)}&object_id={quote_plus(oid)}&edit=1"
        body_rows.append(
            "<tr>"
            f"<td>{html.escape(row.get('timestamp', ''))}</td>"
            f"<td>{html.escape(row.get('respondent_label', ''))}</td>"
            f"<td>{html.escape(row.get('vote', ''))}</td>"
            f"<td>{html.escape(_vote_label(row.get('vote', '')))}</td>"
            f"<td>{html.escape(row.get('district', ''))}</td>"
            f"<td><a class='addr-link' href='{html.escape(edit_url)}'>{html.escape(row.get('address', ''))}</a></td>"
            f"<td>{html.escape(row.get('area_m2', ''))}</td>"
            f"<td>{html.escape(row.get('price_rub', ''))}</td>"
            f"<td>{html.escape(row.get('suggestion_text', ''))}</td>"
            f"<td>{html.escape(row.get('consensus_pct', '0'))}% ({html.escape(row.get('consensus_voters', '0'))}/3)</td>"
            f"<td>{html.escape(row.get('sources', ''))}</td>"
            "</tr>"
        )
    table = "\n".join(body_rows) if body_rows else "<tr><td colspan='11'>Пока нет оценок.</td></tr>"
    return f"""<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>История оценок</title>
  <style>
    body {{ margin: 0; padding: 16px; font-family: "SF Pro Text", "Segoe UI", sans-serif; background: #f8fafc; color: #0f172a; }}
    .wrap {{ max-width: 1200px; margin: 0 auto; }}
    .top {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 12px; }}
    .back {{ color: #0f766e; text-decoration: none; font-weight: 700; }}
    .meta {{ color: #475569; font-size: 14px; }}
    .board {{
      display: grid;
      grid-template-columns: repeat(4, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 14px;
    }}
    .vote-col {{
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      background: #fff;
      overflow: hidden;
    }}
    .vote-col.ok {{ border-color: #86efac; }}
    .vote-col.suggest {{ border-color: #93c5fd; }}
    .vote-col.recheck {{ border-color: #c4b5fd; }}
    .vote-col.bad {{ border-color: #fecaca; }}
    .vote-title {{
      font-weight: 900;
      font-size: 18px;
      padding: 10px 12px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
    }}
    .vote-col.ok .vote-title {{ color: #166534; background: #f0fdf4; }}
    .vote-col.suggest .vote-title {{ color: #1e40af; background: #eff6ff; }}
    .vote-col.recheck .vote-title {{ color: #6d28d9; background: #f5f3ff; }}
    .vote-col.bad .vote-title {{ color: #991b1b; background: #fef2f2; }}
    .who {{ border-top: 1px solid #f1f5f9; padding: 8px 10px; }}
    .who-title {{ font-weight: 700; color: #334155; margin-bottom: 5px; }}
    ul {{ margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; }}
    li {{ border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 7px; }}
    li.empty {{ color: #94a3b8; text-align: center; }}
    .addr {{ font-size: 13px; color: #0f172a; }}
    .addr-link {{ color: #0f172a; text-decoration: none; font-weight: 700; }}
    .addr-link:hover {{ color: #0b7285; text-decoration: underline; }}
    .meta {{ font-size: 12px; color: #64748b; }}
    .agree {{ margin-bottom: 10px; font-size: 14px; color: #334155; }}
    details {{ margin-top: 10px; }}
    summary {{ cursor: pointer; font-weight: 700; color: #334155; margin-bottom: 8px; }}
    table {{ width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #cbd5e1; border-radius: 10px; overflow: hidden; }}
    th, td {{ border-bottom: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; font-size: 14px; vertical-align: top; }}
    th {{ background: #f1f5f9; font-size: 13px; text-transform: uppercase; letter-spacing: .02em; color: #334155; }}
    tr:last-child td {{ border-bottom: none; }}
    @media (max-width: 980px) {{
      .board {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="top">
      <a class="back" href="/">← Назад к карточкам</a>
      <div class="meta">Оценок в таблице: {len(rows)}</div>
    </div>
    <div class="agree">Совпадение 3/3: {agree3_full} из {agree3_total} ({agree3_pct}%)</div>
    <div class="board">
      {''.join(board_cols)}
    </div>
    <details>
      <summary>Полный журнал оценок</summary>
      <table>
        <thead>
          <tr>
            <th>Дата/время</th>
            <th>Опросник</th>
            <th>Код</th>
            <th>Оценка</th>
            <th>Район</th>
            <th>Адрес</th>
            <th>Площадь</th>
            <th>Цена</th>
            <th>Предложение</th>
            <th>Совпадение</th>
            <th>Источники</th>
          </tr>
        </thead>
        <tbody>
          {table}
        </tbody>
      </table>
    </details>
  </div>
</body>
</html>"""


HTML_PAGE = """<!doctype html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Swipe Sale Objects</title>
  <style>
    :root {
      --bg: #edf2f7;
      --card: #ffffff;
      --text: #111827;
      --muted: #4b5563;
      --line: #d1d5db;
      --bad: #b42318;
      --ok: #0f766e;
      --warn: #8b5cf6;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "SF Pro Text", "Segoe UI", sans-serif;
      color: var(--text);
      background: radial-gradient(circle at 10% -20%, #fff, var(--bg));
      padding: 14px;
      min-height: 100vh;
      display: flex;
      justify-content: center;
    }
    .app { width: min(980px, 100%); }
    .top {
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      background: #ffffffcc;
      margin-bottom: 12px;
      display: grid;
      gap: 8px;
    }
    .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .chip {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 13px;
      background: #fff;
      color: var(--muted);
    }
    .chip a {
      color: #0b7285;
      text-decoration: none;
      font-weight: 700;
    }
    .filters { display: flex; flex-wrap: wrap; gap: 8px; }
    .filter-chip {
      border: 1px solid #cbd5e1;
      border-radius: 24px;
      padding: 10px 12px;
      font-size: 13px;
      background: #fff;
      color: #334155;
      cursor: pointer;
      min-width: 180px;
      min-height: 92px;
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: flex-start;
      gap: 4px;
      text-align: left;
      transition: background .2s ease, border-color .2s ease, transform .12s ease;
    }
    .filter-chip:hover { transform: translateY(-1px); }
    .filter-chip .main {
      font-size: 19px;
      line-height: 1.1;
      font-weight: 800;
    }
    .filter-chip .sub {
      font-size: 12px;
      color: #64748b;
      font-weight: 700;
    }
    .filter-chip.active {
      background: #0ea5e9;
      border-color: #0284c7;
      color: #fff;
      font-weight: 700;
    }
    .filter-chip.active .sub { color: #e0f2fe; }
    .people-stats { display: flex; flex-wrap: wrap; gap: 8px; }
    .people-chip {
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 12px;
      color: #475569;
      background: #fff;
    }
    .scale {
      display: grid;
      gap: 6px;
      width: min(520px, 100%);
    }
    .scale-line {
      width: 100%;
      height: 10px;
      border-radius: 999px;
      background: #e2e8f0;
      overflow: hidden;
    }
    .scale-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #22c55e, #14b8a6);
      transition: width .2s ease;
    }
    .scale-text { font-size: 12px; color: #475569; }
    .progress { margin-left: auto; font-size: 14px; color: var(--muted); }
    .card-wrap { perspective: 1100px; touch-action: pan-y; user-select: none; }
    .card {
      border: 1px solid var(--line);
      border-radius: 16px;
      background: var(--card);
      overflow: hidden;
      box-shadow: 0 10px 28px rgba(17, 24, 39, 0.08);
      transition: transform .2s ease, opacity .2s ease;
    }
    .card.swipe-left { transform: translateX(-220px) rotate(-10deg); opacity: 0; }
    .card.swipe-right { transform: translateX(220px) rotate(10deg); opacity: 0; }
    .img {
      width: 100%;
      aspect-ratio: 16 / 9;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #dbeafe, #d1fae5);
      color: #334155;
      font-weight: 700;
      overflow: hidden;
    }
    .img img { width: 100%; height: 100%; object-fit: cover; }
    .content { padding: 14px; display: grid; gap: 8px; }
    .rubric-head {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .rubric-title {
      font-size: 22px;
      line-height: 1.1;
      font-weight: 800;
      text-transform: uppercase;
      color: #7f1d1d;
      letter-spacing: 0.02em;
      padding: 8px 12px;
      border-radius: 12px;
      border: 1px solid #fecaca;
      background: linear-gradient(180deg, #fff7f7 0%, #fff1f2 100%);
      width: fit-content;
      max-width: 100%;
    }
    .rubric-hint {
      font-size: 12px;
      color: #64748b;
      max-width: 420px;
    }
    .rubric-title.rubric-missing {
      color: #9a3412;
      border-color: #fdba74;
      background: linear-gradient(180deg, #fff9f2 0%, #ffedd5 100%);
    }
    .rubric-title.rubric-inexact {
      color: #9a3412;
      border-color: #f97316;
      background: linear-gradient(180deg, #fff9f1 0%, #ffedd5 100%);
    }
    .rubric-title.rubric-ours_higher {
      color: #9f1239;
      border-color: #fda4af;
      background: linear-gradient(180deg, #fff5f7 0%, #ffe4e6 100%);
    }
    .rubric-title.rubric-ours_lower {
      color: #14532d;
      border-color: #86efac;
      background: linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%);
    }
    .rubric-title.rubric-fresh_missing {
      color: #1d4ed8;
      border-color: #93c5fd;
      background: linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%);
    }
    .rubric-title.rubric-urgent_refresh {
      color: #991b1b;
      border-color: #ef4444;
      background: linear-gradient(180deg, #fff5f5 0%, #fee2e2 100%);
      box-shadow: 0 0 0 2px #fecaca inset;
    }
    .rubric-title.rubric-duplicate_exact {
      color: #7f1d1d;
      border-color: #dc2626;
      background: linear-gradient(180deg, #fef2f2 0%, #fee2e2 100%);
      box-shadow: 0 0 0 2px #fca5a5 inset;
    }
    .title { font-size: 27px; font-weight: 800; line-height: 1.2; }
    .meta { color: var(--muted); font-size: 15px; }
    .prio {
      display: inline-block;
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid var(--line);
      width: fit-content;
    }
    .prio.low { background: #fff1f2; border-color: #fecdd3; color: #9f1239; }
    .prio.high { background: #ecfeff; border-color: #bae6fd; color: #0e7490; }
    .prio.missing { background: #fff7ed; border-color: #fdba74; color: #9a3412; font-weight: 700; }
    .prio.inexact { background: #fff7ed; border-color: #f97316; color: #9a3412; font-weight: 700; }
    .prio.ours_higher { background: #fff1f2; border-color: #fda4af; color: #9f1239; font-weight: 700; }
    .prio.ours_lower { background: #f0fdf4; border-color: #86efac; color: #166534; font-weight: 700; }
    .prio.fresh_missing { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; font-weight: 700; }
    .prio.urgent_refresh { background: #fff5f5; border-color: #ef4444; color: #991b1b; font-weight: 700; }
    .prio.duplicate_exact { background: #fff1f2; border-color: #ef4444; color: #991b1b; font-weight: 700; }
    .prio.npro { background: #f5f3ff; border-color: #c4b5fd; color: #5b21b6; font-weight: 700; }
    .our {
      margin-top: 2px;
      border: 1px solid #fed7aa;
      background: #fffaf0;
      color: #7c2d12;
      border-radius: 10px;
      padding: 8px 10px;
      font-size: 14px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4px;
      font-size: 14px;
    }
    th, td {
      border-top: 1px solid var(--line);
      padding: 8px 6px;
      text-align: left;
      vertical-align: top;
    }
    th { color: #334155; font-size: 12px; text-transform: uppercase; }
    tr.row-fresh td { background: #f8fff9; }
    tr.row-stale td { background: #fff8f8; }
    .status-tag {
      display: inline-block;
      margin-top: 3px;
      font-size: 12px;
      border-radius: 999px;
      border: 1px solid #cbd5e1;
      padding: 2px 7px;
      color: #334155;
      background: #f8fafc;
    }
    .status-tag.fresh {
      border-color: #86efac;
      background: #f0fdf4;
      color: #166534;
    }
    .status-tag.stale {
      border-color: #fca5a5;
      background: #fef2f2;
      color: #991b1b;
    }
    .link { color: #0b7285; text-decoration: none; }
    .actions {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-top: 12px;
    }
    .actions.three {
      grid-template-columns: repeat(3, 1fr);
    }
    .actions button {
      border-radius: 12px;
      border: 1px solid var(--line);
      padding: 20px 18px;
      font-size: 34px;
      font-weight: 700;
      cursor: pointer;
      background: #fff;
      min-height: 96px;
      line-height: 1.1;
    }
    .b-left { color: var(--bad); background: #fff5f5; border-color: #fecaca; }
    .b-suggest { color: #1d4ed8; background: #eff6ff; border-color: #93c5fd; }
    .b-mid { color: var(--warn); background: #f5f3ff; border-color: #ddd6fe; }
    .b-mid.hidden { display: none; }
    .b-right { color: var(--ok); background: #f0fdfa; border-color: #99f6e4; }
    .hint {
      margin-top: 8px;
      text-align: center;
      font-size: 13px;
      color: var(--muted);
    }
    .done {
      text-align: center;
      border: 1px solid var(--line);
      border-radius: 16px;
      background: #fff;
      padding: 40px 18px;
      font-size: 24px;
      color: #334155;
    }
    .poll-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.45);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 2000;
      padding: 14px;
    }
    .poll-box {
      width: min(560px, 100%);
      background: #fff;
      border-radius: 16px;
      border: 1px solid var(--line);
      padding: 18px;
      box-shadow: 0 20px 40px rgba(15, 23, 42, 0.25);
      display: grid;
      gap: 10px;
    }
    .poll-title {
      font-size: 22px;
      font-weight: 800;
      color: #0f172a;
    }
    .poll-actions {
      display: grid;
      gap: 8px;
    }
    .poll-btn {
      text-align: left;
      border-radius: 10px;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      padding: 10px 12px;
      font-size: 17px;
      color: #0f172a;
      font-weight: 700;
      cursor: pointer;
    }
    .poll-note {
      font-size: 13px;
      color: #475569;
    }
    .reaction {
      position: fixed;
      right: 22px;
      bottom: 24px;
      width: min(260px, 45vw);
      border-radius: 14px;
      overflow: hidden;
      box-shadow: 0 18px 36px rgba(15, 23, 42, 0.35);
      background: #0f172a;
      color: #fff;
      z-index: 2500;
      opacity: 0;
      transform: translateY(12px) scale(.98);
      pointer-events: none;
      transition: opacity .22s ease, transform .22s ease;
    }
    .reaction.show {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    .reaction img {
      width: 100%;
      display: block;
      aspect-ratio: 4 / 3;
      object-fit: cover;
      background: #1e293b;
    }
    .reaction .cap {
      padding: 8px 10px;
      font-size: 14px;
      font-weight: 700;
      text-align: center;
    }
    @media (max-width: 720px) {
      .rubric-title { font-size: 18px; }
      .title { font-size: 22px; }
      .actions { grid-template-columns: 1fr; }
      .actions button { font-size: 30px; min-height: 88px; }
      table { font-size: 13px; }
      .filters { gap: 6px; }
      .filter-chip { min-width: calc(50% - 6px); min-height: 86px; padding: 8px 10px; }
      .filter-chip .main { font-size: 16px; }
      .scale { width: 100%; }
      .reaction {
        right: 10px;
        left: 10px;
        width: auto;
        bottom: 10px;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <div class="top">
      <div class="row">
        <span class="chip" id="totalObjects">Объектов: 0</span>
        <span class="chip" id="prioObjects">Приоритет (топ 50%): 0</span>
        <span class="chip" id="tailObjects">Хвост (старые): 0</span>
        <span class="chip" id="urgentRefresh">Рубрика «СРОЧНО АКТУАЛИЗИРОВАТЬ»: 0</span>
        <span class="chip" id="freshMissing">Рубрика «Актуализируем брат, а?»: 0</span>
        <span class="chip" id="dupExact">Рубрика «срочно удалить дубль»: 0</span>
        <span class="chip" id="nproCount">Спарсили с Н ПРО: 0</span>
        <span class="chip" id="rest2Count">Объекты Rest2Rent: 0</span>
        <span class="chip" id="multiMissing">Рубрика «а с хрена ли у нас нет»: 0</span>
        <span class="chip" id="inexactCount">Рубрика «неточное совпадение»: 0</span>
        <span class="chip" id="oursHigher">Рубрика «у нас дороже»: 0</span>
        <span class="chip" id="oursLower">Рубрика «у нас дешевле >10%»: 0</span>
        <span class="progress" id="progress">0 / 0</span>
      </div>
      <div class="row">
        <span class="chip" id="whoChip">Опросник: не выбран</span>
        <span class="chip" id="waitingChip">Ждём ответа: -</span>
        <span class="chip"><a href="/votes" target="_blank" rel="noopener">История оценок</a></span>
        <span class="chip" id="stTotal">Оценено: 0</span>
        <span class="chip" id="stLeft">Ай херня: 0</span>
        <span class="chip" id="stSuggest">Предложение: 0</span>
        <span class="chip" id="stRecheck">Перепроверь: 0</span>
        <span class="chip" id="stRight">О нормально: 0</span>
        <span class="chip" id="stConsensus">Совпадение 3/3: 0/0 (0%)</span>
        <button class="chip" id="btnClearVotes" style="display:none;cursor:pointer;">Очистить все ответы</button>
      </div>
      <div class="row">
        <div class="scale">
          <div class="scale-line"><div class="scale-fill" id="answerFill"></div></div>
          <div class="scale-text" id="answerScaleText">Ответил: 0 из 0 (0%) · Не отвечено: 0</div>
        </div>
      </div>
      <div class="row people-stats" id="peopleStats"></div>
      <div class="row filters" id="filterBar"></div>
    </div>

    <div class="card-wrap" id="cardWrap"></div>

    <div class="actions" id="actionsBar">
      <button class="b-left" id="btnLeft">← ай херня</button>
      <button class="b-suggest" id="btnSuggest">↑ предложение</button>
      <button class="b-mid" id="btnMid">что ты мелишь, у нас есть этот объект - перепроверь</button>
      <button class="b-right" id="btnRight">о нормально →</button>
    </div>
    <div class="hint">Свайп: влево/вправо. Клавиши: ← / ↑(предложение) / ↓(перепроверка) / →.</div>
  </div>

  <div class="reaction" id="reactionBox">
    <img id="reactionImg" alt="reaction gif" />
    <div class="cap" id="reactionCap"></div>
  </div>

  <div class="poll-overlay" id="pollOverlay">
    <div class="poll-box">
      <div class="poll-title">Кто опросник?</div>
      <div class="poll-actions" id="pollActions"></div>
      <div class="poll-note" id="pollNote"></div>
    </div>
  </div>

  <div class="poll-overlay" id="introOverlay">
    <div class="poll-box">
      <div class="poll-title">Кто я и что тут происходит</div>
      <div class="poll-note">
        Я сравниваю объекты конкурентов с вашей базой и показываю приоритетные карточки по продажам.
        Ваша задача: оценивать карточки кнопками, чтобы быстро разобрать «что взять в работу», «что проверить», «что отбраковать».
      </div>
      <button class="poll-btn" id="introCloseBtn">Понятно, поехали</button>
    </div>
  </div>

<script>
let state = {
  index: 0,
  total: 0,
  lock: false,
  touchX: null,
  sessionId: null,
  respondentId: '',
  respondentLabel: '',
  allowRecheck: true,
  reactionTimer: null,
  filterKey: 'all',
  filterDefs: [],
  jumpObjectId: '',
  currentObjectId: '',
  editMode: false,
  preferredRespondentId: '',
};

const REACTION_GIFS = {
  left: [
    {url: 'https://media.giphy.com/media/3og0INyCmHlNylks9O/giphy.gif', cap: 'Ай херня'},
    {url: 'https://media.giphy.com/media/l0MYu38R0PPhIXe36/giphy.gif', cap: 'Не берем'},
    {url: 'https://media.giphy.com/media/10tIjpzIu8fe0/giphy.gif', cap: 'Мимо'},
  ],
  right: [
    {url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif', cap: 'О нормально'},
    {url: 'https://media.giphy.com/media/26u4lOMA8JKSnL9Uk/giphy.gif', cap: 'В работу'},
    {url: 'https://media.giphy.com/media/l3q2K5jinAlChoCLS/giphy.gif', cap: 'Хорошо выглядит'},
  ],
  recheck: [
    {url: 'https://media.giphy.com/media/3orieUe6ejxSFxYCXe/giphy.gif', cap: 'Перепроверяем'},
    {url: 'https://media.giphy.com/media/26n6WywJyh39n1pBu/giphy.gif', cap: 'Проверить вручную'},
    {url: 'https://media.giphy.com/media/l0HlvtIPzPdt2usKs/giphy.gif', cap: 'Надо уточнить'},
  ],
};

function esc(s) {
  return String(s || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function parseInitialStateFromUrl() {
  const p = new URLSearchParams(window.location.search || '');
  state.filterKey = p.get('filter') || 'all';
  state.jumpObjectId = p.get('object_id') || '';
  state.editMode = p.get('edit') === '1';
  state.preferredRespondentId = p.get('respondent_id') || localStorage.getItem('swipe_respondent_id') || '';
}

function updateUrlState() {
  const p = new URLSearchParams();
  if (state.filterKey && state.filterKey !== 'all') p.set('filter', state.filterKey);
  if (state.respondentId) p.set('respondent_id', state.respondentId);
  if (state.jumpObjectId) p.set('object_id', state.jumpObjectId);
  if (state.editMode && state.jumpObjectId) p.set('edit', '1');
  const qs = p.toString();
  const next = qs ? `/?${qs}` : '/';
  window.history.replaceState(null, '', next);
}

async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

async function jpost(url, data) {
  const r = await fetch(url, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(data),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

async function refreshMeta() {
  const q = new URLSearchParams();
  if (state.respondentId) q.set('respondent_id', state.respondentId);
  const m = await jget('/api/meta?' + q.toString());
  state.filterDefs = m.filters || [];
  document.getElementById('totalObjects').textContent = `Объектов: ${m.total_objects}`;
  document.getElementById('prioObjects').textContent = `Приоритет (топ 50%): ${m.priority_objects}`;
  document.getElementById('tailObjects').textContent = `Хвост (старые): ${m.tail_objects}`;
  document.getElementById('urgentRefresh').textContent = `Рубрика «СРОЧНО АКТУАЛИЗИРОВАТЬ»: ${m.urgent_refresh_objects || 0}`;
  document.getElementById('freshMissing').textContent = `Рубрика «Актуализируем брат, а?»: ${m.fresh_missing_objects || 0}`;
  document.getElementById('dupExact').textContent = `Рубрика «срочно удалить дубль»: ${m.duplicate_exact_objects || 0}`;
  document.getElementById('nproCount').textContent = `Спарсили с Н ПРО: ${m.npro_objects || 0}`;
  document.getElementById('rest2Count').textContent = `Объекты Rest2Rent: ${m.rest2rent_objects || 0}`;
  document.getElementById('multiMissing').textContent = `Рубрика «а с хрена ли у нас нет»: ${m.multi_missing_objects}`;
  document.getElementById('inexactCount').textContent = `Рубрика «неточное совпадение»: ${m.inexact_objects}`;
  document.getElementById('oursHigher').textContent = `Рубрика «у нас дороже»: ${m.ours_higher_objects}`;
  document.getElementById('oursLower').textContent = `Рубрика «у нас дешевле >10%»: ${m.ours_lower_10_objects || 0}`;
  const clearBtn = document.getElementById('btnClearVotes');
  if (clearBtn) clearBtn.style.display = state.respondentId === 'test' ? 'inline-block' : 'none';
  renderFilters();
  applyPollSummary(m.poll || {});
}

async function refreshStats() {
  const q = new URLSearchParams();
  q.set('filter', state.filterKey || 'all');
  if (state.respondentId) q.set('respondent_id', state.respondentId);
  const st = await jget('/api/stats?' + q.toString());
  document.getElementById('stTotal').textContent = `Оценено в фильтре: ${st.total}`;
  document.getElementById('stLeft').textContent = `Ай херня: ${st.left}`;
  document.getElementById('stSuggest').textContent = `Предложение: ${st.suggest || 0}`;
  document.getElementById('stRecheck').textContent = `Перепроверь: ${st.recheck}`;
  document.getElementById('stRight').textContent = `О нормально: ${st.right}`;
  const fullText = `Совпадение 3/3: ${st.consensus_full_3}/${st.consensus_full_3_total} (${st.consensus_full_3_pct}%)`;
  const consensusChip = document.getElementById('stConsensus');
  if (consensusChip) consensusChip.textContent = fullText;

  const fill = document.getElementById('answerFill');
  const txt = document.getElementById('answerScaleText');
  if (fill) fill.style.width = `${st.current_pct || 0}%`;
  if (txt) {
    txt.textContent = `Ответил: ${st.current_answered || 0} из ${st.filter_total || 0} (${st.current_pct || 0}%) · Не отвечено: ${st.current_pending || 0}`;
  }

  renderPeopleStats(st.people || [], st.filter_total || 0);
}

function renderPeopleStats(people, total) {
  const root = document.getElementById('peopleStats');
  if (!root) return;
  root.innerHTML = '';
  for (const p of people) {
    const el = document.createElement('span');
    el.className = 'people-chip';
    el.textContent = `${p.label}: ${p.answered}/${total} (${p.pct}%)`;
    root.appendChild(el);
  }
}

function renderFilters() {
  const root = document.getElementById('filterBar');
  if (!root) return;
  root.innerHTML = '';
  for (const f of (state.filterDefs || [])) {
    const isActive = state.filterKey === f.key;
    const btn = document.createElement('button');
    btn.className = 'filter-chip' + (isActive ? ' active' : '');
    const pct = Number(f.pct || 0);
    btn.style.background = isActive
      ? 'linear-gradient(180deg, #0ea5e9 0%, #0284c7 100%)'
      : `linear-gradient(to top, rgba(14,165,233,0.16) ${pct}%, #ffffff ${pct}%)`;
    btn.innerHTML = `<div class="main">${esc(f.label)}: ${Number(f.pending || 0)}</div><div class="sub">отвечено ${pct}% (${Number(f.answered || 0)}/${Number(f.count || 0)})</div>`;
    btn.addEventListener('click', async () => {
      if (state.filterKey === f.key) return;
      state.filterKey = f.key;
      state.index = 0;
      state.jumpObjectId = '';
      state.editMode = false;
      updateUrlState();
      await loadCard();
      await refreshStats();
      await refreshMeta();
    });
    root.appendChild(btn);
  }
}

function renderDone(total) {
  const waiting = document.getElementById('waitingChip').textContent || 'Ждём ответа: -';
  document.getElementById('cardWrap').innerHTML = `<div class="done">Карточки закончились<br>(${total} объектов)<br><small>${esc(waiting)}</small></div>`;
  document.getElementById('progress').textContent = `${total} / ${total}`;
}

function unifiedRows(rows) {
  if (!rows || rows.length === 0) return '<div class="meta">Нет данных для сравнения</div>';
  let html = '<table><thead><tr><th>Источник</th><th>Позиция / статус</th><th>Площадь</th><th>Цена</th><th>Точность / вывод</th><th>Ссылка</th></tr></thead><tbody>';
  for (const r of rows) {
    const area = r.area_m2 ? `${r.area_m2} м²` : '';
    const price = r.price_rub ? `${r.price_rub} ₽` : '';
    const statusTag = r.status_text
      ? `<div class="status-tag ${esc(r.status_class || '')}">${esc(r.status_text)}</div>`
      : '';
    const link = r.link_url ? `<a class="link" href="${esc(r.link_url)}" target="_blank" rel="noopener">${esc(r.link_label || 'открыть')}</a>` : '';
    const rowClass = r.status_class === 'fresh' ? 'row-fresh' : (r.status_class === 'stale' ? 'row-stale' : '');
    html += `<tr class="${rowClass}">
      <td>${esc(r.source_label || '')}</td>
      <td>${esc(r.pos_or_status || '')}${statusTag}</td>
      <td>${esc(area)}</td>
      <td>${esc(price)}</td>
      <td>${esc(r.accuracy || '')}</td>
      <td>${link}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
}

function applyPollSummary(summary) {
  const missing = summary?.missing_names || [];
  const responded = summary?.responded_names || [];
  const waitingText = missing.length ? missing.join(', ') : 'все ответили';
  const respondedText = responded.length ? responded.join(', ') : 'пока никто';
  document.getElementById('waitingChip').textContent = `Ждём ответа: ${waitingText}`;
  const note = document.getElementById('pollNote');
  if (note) {
    note.textContent = `Ответили сегодня: ${respondedText}.`;
  }
}

function showReaction(direction) {
  const pack = REACTION_GIFS[direction] || [];
  if (!pack.length) return;
  const r = pack[Math.floor(Math.random() * pack.length)];
  const box = document.getElementById('reactionBox');
  const img = document.getElementById('reactionImg');
  const cap = document.getElementById('reactionCap');
  if (!box || !img || !cap) return;
  img.src = r.url;
  img.onerror = () => {
    img.removeAttribute('src');
  };
  cap.textContent = r.cap || '';
  box.classList.add('show');
  if (state.reactionTimer) {
    clearTimeout(state.reactionTimer);
  }
  state.reactionTimer = setTimeout(() => {
    box.classList.remove('show');
  }, 1800);
}

async function initPoll() {
  const data = await jget('/api/poll/options');
  applyPollSummary(data.summary || {});

  const overlay = document.getElementById('pollOverlay');
  const actions = document.getElementById('pollActions');
  actions.innerHTML = '';

  async function startRespondent(rid, reloadAfter = true) {
    const resp = await jpost('/api/poll/start', {respondent_id: rid});
    state.sessionId = resp.session_id;
    state.respondentId = resp.respondent_id;
    state.respondentLabel = resp.respondent_label;
    localStorage.setItem('swipe_respondent_id', state.respondentId);
    document.getElementById('whoChip').textContent = `Опросник: ${state.respondentLabel}`;
    applyPollSummary(resp.summary || {});
    await refreshMeta();
    updateUrlState();
    if (reloadAfter) {
      state.index = 0;
      await loadCard();
      await refreshStats();
    }
  }

  const preferred = state.preferredRespondentId;
  if (preferred && (data.options || []).some(x => x.id === preferred)) {
    await startRespondent(preferred, false);
    overlay.style.display = 'none';
  }

  for (const opt of (data.options || [])) {
    const btn = document.createElement('button');
    btn.className = 'poll-btn';
    btn.textContent = opt.label;
    btn.addEventListener('click', async () => {
      await startRespondent(opt.id, true);
      overlay.style.display = 'none';
    });
    actions.appendChild(btn);
  }
  if (!state.respondentId) {
    overlay.style.display = 'flex';
  }
}

function renderCard(payload) {
  const card = payload.card;
  const pano = card.panorama_url
    ? `<div style="margin-top:8px;font-size:14px;"><a class="link" href="${esc(card.panorama_url)}" target="_blank" rel="noopener">Открыть панораму/карту</a></div>`
    : '';
  const img = card.photo_url
    ? `<img id="cardPhoto" src="${esc(card.photo_url)}" alt="photo" referrerpolicy="no-referrer" />`
    : `<div id="cardPhotoFallback">Фото не найдено${pano}</div>`;

  const badge = card.top_half_object
    ? '<span class="prio high">В приоритете: есть в топ-50% у конкурента</span>'
    : '<span class="prio low">Старое объявление: все позиции ниже 50%</span>';
  const nproBadge = card.has_npro
    ? `<span class="prio npro">Спарсили с Н ПРО${(card.npro_sources || []).length ? ': ' + esc((card.npro_sources || []).join(', ')) : ''}</span>`
    : '';
  const ours = card.our_presence || {};
  const gap = card.price_gap || null;
  let gapLine = '';
  if (gap) {
    if (gap.direction === 'ours_higher') {
      gapLine = `<div class="our">Цена sale у нас (мин): ${esc(gap.our_min_sale_price || '')} ₽ · мин. у конкурентов: ${esc(gap.competitor_min_price || '')} ₽ · у нас дороже на ${esc(gap.diff_rub || '')} ₽ (${esc(gap.diff_pct || '')}%)</div>`;
    } else if (gap.direction === 'ours_lower') {
      gapLine = `<div class="our">Цена sale у нас (мин): ${esc(gap.our_min_sale_price || '')} ₽ · мин. у конкурентов: ${esc(gap.competitor_min_price || '')} ₽ · у нас дешевле на ${esc(gap.diff_rub || '')} ₽ (${esc(gap.diff_pct || '')}%)</div>`;
    } else {
      gapLine = `<div class="our">Цена sale у нас (мин): ${esc(gap.our_min_sale_price || '')} ₽ · мин. у конкурентов: ${esc(gap.competitor_min_price || '')} ₽ · цены равны</div>`;
    }
  }
  let oursBlock = '';
  if ((ours.any_count || 0) > 0) {
    oursBlock = `<div class="our">У нас по адресу найдено: ${ours.any_count} · sale: ${ours.sale_count || 0} · rent: ${ours.rent_count || 0} · на сайте: ${ours.on_site_count || 0} · архив: ${ours.archive_count || 0} · неуверенных совпадений: ${ours.uncertain_count || 0}</div>`;
  } else if ((ours.uncertain_count || 0) > 0) {
    oursBlock = `<div class="our">Точного совпадения у нас нет, но есть похожая сделка: ${ours.uncertain_count}</div>`;
  } else {
    oursBlock = '<div class="our">У нас по этому адресу не найдено ни одного объекта в deals.xml</div>';
  }
  const noSaleLine = ((ours.any_count || 0) > 0 && (ours.sale_count || 0) === 0)
    ? '<div class="our">По адресу объект у нас есть, но сделки SALE нет.</div>'
    : '';
  const inexactLine = card.inexact_note ? `<div class="our">${esc(card.inexact_note)}</div>` : '';
  const dupLine = (ours.has_exact_sale_duplicate || false)
    ? `<div class="our"><b>СРОЧНО УДАЛИТЬ ДУБЛЬ:</b> у нас найдено ${Number(ours.exact_sale_duplicate_count || 0)} одинаковых продаж (тот же адрес и площадь).</div>`
    : '';
  const rubricTitle = card.rubric
    ? `<div class="rubric-head"><div class="rubric-title rubric-${esc(card.rubric_class || 'missing')}">${esc(card.rubric)}</div><div class="rubric-hint">${esc(card.rubric_hint || '')}</div></div>`
    : '';

  state.allowRecheck = card.show_recheck_button !== false;
  state.currentObjectId = card.object_id || '';
  const midBtn = document.getElementById('btnMid');
  const actions = document.getElementById('actionsBar');
  if (midBtn) {
    if (state.allowRecheck) {
      midBtn.classList.remove('hidden');
      midBtn.disabled = false;
      if (actions) actions.classList.remove('three');
    } else {
      midBtn.classList.add('hidden');
      midBtn.disabled = true;
      if (actions) actions.classList.add('three');
    }
  }

  document.getElementById('cardWrap').innerHTML = `
    <div class="card" id="card">
      <div class="img">${img}</div>
      <div class="content">
        ${rubricTitle}
        <div class="title">${esc(card.address)}</div>
        <div class="meta">Район: ${esc(card.district)} · Сделка: SALE · Источников: ${card.source_count}</div>
        ${badge}
        ${nproBadge}
        ${oursBlock}
        ${noSaleLine}
        ${inexactLine}
        ${dupLine}
        ${gapLine}
        ${unifiedRows(card.comparison_rows || [])}
      </div>
    </div>
  `;

  document.getElementById('progress').textContent = `${payload.index + 1} / ${payload.total}`;

  const photo = document.getElementById('cardPhoto');
  if (photo) {
    photo.onerror = () => {
      const holder = photo.parentElement;
      if (holder) {
        holder.innerHTML = `<div id="cardPhotoFallback">Фото не найдено${pano}</div>`;
      }
    };
  }

  const el = document.getElementById('card');
  el.addEventListener('touchstart', e => {
    if (e.changedTouches.length > 0) {
      state.touchX = e.changedTouches[0].clientX;
    }
  }, {passive: true});

  el.addEventListener('touchend', e => {
    if (state.touchX === null || e.changedTouches.length === 0) return;
    const threshold = window.innerWidth < 760 ? 42 : 56;
    const dx = e.changedTouches[0].clientX - state.touchX;
    state.touchX = null;
    if (dx < -threshold) vote('left');
    if (dx > threshold) vote('right');
  }, {passive: true});
}

async function loadCard() {
  const q = new URLSearchParams();
  q.set('index', String(state.index));
  q.set('filter', state.filterKey || 'all');
  if (state.respondentId) q.set('respondent_id', state.respondentId);
  if (state.jumpObjectId) q.set('object_id', state.jumpObjectId);
  const payload = await jget('/api/card?' + q.toString());
  state.total = payload.total || 0;
  if (payload.done) {
    if (state.jumpObjectId) {
      state.jumpObjectId = '';
      state.editMode = false;
      updateUrlState();
      state.index = 0;
      return await loadCard();
    }
    renderDone(state.total);
    return;
  }
  renderCard(payload);
  if (state.jumpObjectId && payload.card && payload.card.object_id === state.jumpObjectId) {
    state.jumpObjectId = '';
    state.editMode = false;
    updateUrlState();
  }
}

async function vote(direction) {
  if (direction === 'recheck' && !state.allowRecheck) {
    return;
  }
  if (!state.sessionId || !state.respondentId) {
    document.getElementById('pollOverlay').style.display = 'flex';
    return;
  }
  if (state.lock) return;
  let suggestionText = '';
  if (direction === 'suggest') {
    const txt = window.prompt('Напиши пожелания для улучшения меня.', '');
    if (txt === null) return;
    suggestionText = String(txt || '').trim();
  }
  state.lock = true;
  try {
    const card = document.getElementById('card');
    if (card && (direction === 'left' || direction === 'right')) {
      card.classList.add(direction === 'left' ? 'swipe-left' : 'swipe-right');
      await new Promise(r => setTimeout(r, 180));
    }

    const resp = await jpost('/api/vote', {
      index: state.index,
      vote: direction,
      session_id: state.sessionId,
      respondent_id: state.respondentId,
      object_id: state.currentObjectId,
      suggestion_text: suggestionText,
    });
    showReaction(direction);
    state.index = resp.next_index;
    await loadCard();
    await refreshStats();
    await refreshMeta();
  } catch (e) {
    alert('Ошибка: ' + e.message);
  } finally {
    state.lock = false;
  }
}

async function boot() {
  parseInitialStateFromUrl();
  await refreshMeta();
  await initPoll();
  await refreshMeta();
  await loadCard();
  await refreshStats();

  document.getElementById('btnLeft').addEventListener('click', () => vote('left'));
  document.getElementById('btnSuggest').addEventListener('click', () => vote('suggest'));
  document.getElementById('btnMid').addEventListener('click', () => vote('recheck'));
  document.getElementById('btnRight').addEventListener('click', () => vote('right'));
  const clearBtn = document.getElementById('btnClearVotes');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      if (state.respondentId !== 'test') return;
      const ok = window.confirm('Очистить ВСЕ ответы всех пользователей?');
      if (!ok) return;
      await jpost('/api/admin/clear-votes', {respondent_id: state.respondentId});
      state.index = 0;
      await refreshMeta();
      await refreshStats();
      await loadCard();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') vote('left');
    if (e.key === 'ArrowRight') vote('right');
    if (e.key === 'ArrowUp') vote('suggest');
    if (e.key === 'ArrowDown' && state.allowRecheck) vote('recheck');
  });

  const introSeen = localStorage.getItem('swipe_intro_seen') === '1';
  const intro = document.getElementById('introOverlay');
  const introBtn = document.getElementById('introCloseBtn');
  if (intro && introBtn) {
    if (!introSeen) intro.style.display = 'flex';
    introBtn.addEventListener('click', () => {
      intro.style.display = 'none';
      localStorage.setItem('swipe_intro_seen', '1');
    });
  }
}

boot().catch(err => {
  document.getElementById('cardWrap').innerHTML = `<div class="done">Ошибка запуска: ${esc(err.message)}</div>`;
});
</script>
</body>
</html>
"""


class SwipeHandler(BaseHTTPRequestHandler):
    state: SwipeState | None = None

    def _json(self, payload: dict[str, Any], status: int = HTTPStatus.OK) -> None:
        raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _text(self, text: str, status: int = HTTPStatus.OK) -> None:
        raw = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _bytes(self, data: bytes, content_type: str, status: int = HTTPStatus.OK) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.state is None:
            self._json({"error": "server_state_missing"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if path.startswith("/respondent_id="):
            rid = clean_text(path.split("=", 1)[1])
            target = f"/?respondent_id={quote_plus(rid)}" if rid else "/"
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", target)
            self.end_headers()
            return

        if path == "/":
            self._text(HTML_PAGE)
            return

        if path == "/votes":
            rows = self.state.votes_history(limit=10000)
            self._text(build_votes_html(rows))
            return

        if path == "/api/meta":
            respondent_id = clean_text((params.get("respondent_id") or [""])[0])
            self._json(self.state.meta(respondent_id))
            return

        if path == "/api/card":
            index = to_int((params.get("index") or ["0"])[0], 0)
            respondent_id = clean_text((params.get("respondent_id") or [""])[0])
            filter_key = clean_text((params.get("filter") or ["all"])[0]) or "all"
            object_id = clean_text((params.get("object_id") or [""])[0])
            self._json(self.state.get_card(index, respondent_id, filter_key, object_id))
            return

        if path == "/api/photo":
            src = clean_text((params.get("src") or [""])[0])
            if not src:
                self._json({"error": "src_required"}, status=HTTPStatus.BAD_REQUEST)
                return
            blob = self.state.get_photo_blob(src)
            if blob is None:
                self._json({"error": "photo_unavailable"}, status=HTTPStatus.NOT_FOUND)
                return
            data, content_type = blob
            self._bytes(data, content_type, status=HTTPStatus.OK)
            return

        if path == "/api/stats":
            respondent_id = clean_text((params.get("respondent_id") or [""])[0])
            filter_key = clean_text((params.get("filter") or ["all"])[0]) or "all"
            self._json(self.state.stats(respondent_id, filter_key))
            return

        if path == "/api/votes":
            self._json({"rows": self.state.votes_history(limit=10000)})
            return

        if path == "/api/poll/options":
            self._json(self.state.poll_options())
            return

        if path == "/api/poll/summary":
            self._json(self.state.poll_summary())
            return

        self._json({"error": "not_found"}, status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802
        if self.state is None:
            self._json({"error": "server_state_missing"}, status=HTTPStatus.INTERNAL_SERVER_ERROR)
            return

        parsed = urlparse(self.path)
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        raw = self.rfile.read(max(0, size)) if size else b"{}"

        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            self._json({"error": "invalid_json"}, status=HTTPStatus.BAD_REQUEST)
            return

        if parsed.path == "/api/poll/start":
            rid = clean_text(payload.get("respondent_id"))
            try:
                out = self.state.start_session(rid)
            except ValueError:
                self._json({"error": "invalid_respondent"}, status=HTTPStatus.BAD_REQUEST)
                return
            self._json(out)
            return

        if parsed.path == "/api/admin/clear-votes":
            rid = clean_text(payload.get("respondent_id"))
            try:
                out = self.state.clear_all_votes(rid)
            except ValueError:
                self._json({"error": "forbidden"}, status=HTTPStatus.FORBIDDEN)
                return
            self._json(out)
            return

        if parsed.path != "/api/vote":
            self._json({"error": "not_found"}, status=HTTPStatus.NOT_FOUND)
            return

        index = to_int(payload.get("index"), -1)
        vote = clean_text(payload.get("vote"))
        session_id = payload.get("session_id")
        try:
            session_id_int = int(session_id) if session_id not in (None, "") else None
        except Exception:
            session_id_int = None
        respondent_id = clean_text(payload.get("respondent_id"))
        object_id = clean_text(payload.get("object_id"))
        suggestion_text = clean_text(payload.get("suggestion_text"))

        try:
            resp = self.state.save_vote(
                index,
                vote,
                session_id_int,
                respondent_id,
                object_id,
                suggestion_text,
            )
        except (ValueError, IndexError):
            self._json({"error": "invalid_vote_payload"}, status=HTTPStatus.BAD_REQUEST)
            return

        self._json(resp)

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Swipe app for unified sale objects")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument("--base-dir", default=str(Path(__file__).resolve().parent))
    args = parser.parse_args()

    state = SwipeState(Path(args.base_dir))
    SwipeHandler.state = state

    server = ThreadingHTTPServer((args.host, args.port), SwipeHandler)
    print(f"Swipe app: http://{args.host}:{args.port}")
    print(f"Sale objects: {len(state.objects)}")
    print(f"Priority(top-50%): {state.priority_count}")
    print(f"Votes file: {state.votes_path}")
    print(f"Poll DB: {state.poll_db_path}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
