# robot.py
# Сравнение объектов конкурентов с вашей базой deals.xml (rent+sale)
# Вывод: CSV с кликабельными ссылками (HYPERLINK) для Google Sheets / Excel

from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
import re
import csv
import argparse
import json
from datetime import date
from pathlib import Path
import unicodedata
import urllib.request
import urllib.error
import urllib.parse
import time
import random
import ssl

# ====== НАСТРОЙКИ ======
COMPETITORS = {
    "knru": {
        "start_url": "https://knru.ru/commercial/",
        "base": "https://knru.ru",
        "deal_type": "sale",
    },
    "nordwest": {
        "start_url": "https://nordwestinvest.ru/category/kupit",
        "base": "https://nordwestinvest.ru",
        "deal_type": "sale",
    },
    "rest2rent": {
        "start_url": "https://rest2rent.ru/",
        "base": "https://rest2rent.ru",
        "deal_type": "mixed",
    },
    "yandex_map": {
        "start_url": "https://realty.yandex.ru/sankt-peterburg/kupit/kommercheskaya-nedvizhimost/karta/?bottomLatitude=59.563001&leftLongitude=28.43339&rightLongitude=32.455103&topLatitude=60.407923&uid=1130000038052980&zoom=9.16",
        "base": "https://realty.yandex.ru",
        "deal_type": "sale",
    },
}

HEADLESS = False

# ваш XML лежит рядом с robot.py в папке Parser:
MY_XML_FILENAME = "deals.xml"

# порог площади для "тот же объект"
AREA_TOL = 5.0


# ====== УТИЛИТЫ ТЕКСТА / ЧИСЕЛ ======
def clean_text(s: str | None) -> str | None:
    if not s:
        return None
    return s.replace("\xa0", " ").strip()


def extract_first_number(text: str | None):
    if not text:
        return None
    t = clean_text(text) or ""
    m = re.search(r"(\d[\d\s]*[.,]?\d*)", t)
    if not m:
        return None
    num = m.group(1).replace(" ", "").replace(",", ".")
    try:
        return float(num) if "." in num else int(num)
    except Exception:
        return None


def extract_all_numbers(text: str | None):
    if not text:
        return []
    t = clean_text(text) or ""
    out = []
    for m in re.finditer(r"(\d[\d\s]*[.,]?\d*)", t):
        num = m.group(1).replace(" ", "").replace(",", ".")
        try:
            out.append(float(num) if "." in num else int(num))
        except Exception:
            continue
    return out


def parse_area_and_price_text(text: str | None):
    """
    Возвращает (area_m2, price_rub):
    - площадь: первое число в строке
    - цена: последнее число, кроме случаев "руб/м2"
    """
    if not text:
        return None, None
    t = (clean_text(text) or "").lower()
    nums = extract_all_numbers(t)
    if not nums:
        return None, None

    area_m2 = nums[0]
    price_rub = None

    per_m2 = "руб./м2" in t or "руб/м2" in t or "р/м2" in t
    if not per_m2 and len(nums) >= 2:
        price_rub = nums[-1]

    return area_m2, price_rub


def format_int_spaces(x):
    if x is None:
        return ""
    try:
        n = int(round(float(x)))
    except Exception:
        return str(x)
    return f"{n:,}".replace(",", " ")


def hyperlink(url: str | None, text="ссылка"):
    if not url:
        return ""
    # Формула для Google Sheets/Excel
    return f'=HYPERLINK("{url}","{text}")'


def extract_listing_id(url: str | None) -> str:
    if not url:
        return ""
    m = re.search(r"-(\d+)/?$", url.strip())
    return m.group(1) if m else ""


def extract_listing_id_from_tail(url: str | None, pat: str) -> str:
    if not url:
        return ""
    m = re.search(pat, str(url))
    return (m.group(1) if m else "").strip()


def absolute_url(base_url: str, url: str | None):
    if not url:
        return None
    s = str(url).strip()
    if s.startswith("http://") or s.startswith("https://"):
        return s
    if s.startswith("//"):
        return "https:" + s
    if s.startswith("/"):
        return base_url.rstrip("/") + s
    return base_url.rstrip("/") + "/" + s


def norm_text(s: str) -> str:
    """
    Нормализация:
    - NFKC
    - lower
    - ё->е
    - убрать лишние знаки препинания
    """
    s = unicodedata.normalize("NFKC", s)
    s = s.lower()
    s = s.replace("ё", "е")
    s = s.replace("№", "")
    s = s.replace("\\", " ")
    # Запятую сохраняем: она нужна для разделения "улица, дом"
    s = re.sub(r"[\.;:\(\)\[\]\{\}]", " ", s)
    s = re.sub(r"\s*,\s*", ", ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ====== РАЗБОР АДРЕСА ======
_STREET_EQUIV = [
    (r"\bпроспект\b", "пр"),
    (r"\bпросп\b", "пр"),
    (r"\bпр-кт\b", "пр"),
    (r"\bпр-т\b", "пр"),
    (r"\bпр\.\b", "пр"),
    (r"\bпр\b", "пр"),

    (r"\bулица\b", "ул"),
    (r"\bул\.\b", "ул"),
    (r"\bул\b", "ул"),

    (r"\bнабережная\b", "наб"),
    (r"\bнаб\.\b", "наб"),
    (r"\bнаб\b", "наб"),

    (r"\bпереулок\b", "пер"),
    (r"\bпер\.\b", "пер"),
    (r"\bпер\b", "пер"),

    (r"\bшоссе\b", "ш"),
    (r"\bш\.\b", "ш"),
    (r"\bш\b", "ш"),

    (r"\bкорпус\b", "к"),
    (r"\bкорп\.\b", "к"),
    (r"\bстроение\b", "стр"),
    (r"\bстр\.\b", "стр"),
]

# Дом: 105, 30а, 94/41, 105-107, 70к1, 70к1с1, 70 к1 стр 1
_HOUSE_BLOCK_PAT = re.compile(
    r"(?<!\d)(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?([a-zа-я](?!\d))?"
    r"(?:\s*(?:к|корпус|корп)\s*\.?\s*(\d+[a-zа-я]?))?"
    r"(?:\s*(?:с|стр|строение)\s*\.?\s*(\d+[a-zа-я]?))?",
    re.I,
)

_STREET_DROP_TOKENS = {
    "д",
    "дом",
    "пом",
    "помещение",
    "оф",
    "офис",
    "лит",
    "литера",
    "к",
    "корпус",
    "корп",
    "стр",
    "строение",
}

_STREET_TYPE_TOKENS = {"ул", "пр", "наб", "пер", "ш"}


def normalize_street_part(addr_norm: str) -> str:
    s = addr_norm
    for pat, rep in _STREET_EQUIV:
        s = re.sub(pat, rep, s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _parse_house_from_segment(segment: str, prefer_first: bool):
    matches = list(_HOUSE_BLOCK_PAT.finditer(segment))
    if not matches:
        return None
    hm = matches[0] if prefer_first else matches[-1]

    h_from = int(hm.group(1))
    h_to = int(hm.group(2)) if hm.group(2) else h_from
    h_letter = (hm.group(3) or "").strip()
    corp = (hm.group(4) or "").strip() or None
    stro = (hm.group(5) or "").strip() or None

    return {
        "house_from": h_from,
        "house_to": h_to,
        "house_letter": h_letter,
        "corp": corp,
        "str": stro,
        "span": hm.span(),
    }


def _remove_house_from_segment(segment: str, span: tuple[int, int] | None):
    if not span:
        return segment
    left = segment[: span[0]].strip()
    right = segment[span[1] :].strip()
    if left and right:
        return f"{left} {right}".strip()
    return (left or right).strip()


def _has_real_street_words(text: str):
    if not text:
        return False
    tmp = text
    tmp = re.sub(r"\b(д|дом|к|корп|корпус|с|стр|строение|пом|помещение|оф|офис|лит|литера)\b", " ", tmp)
    tmp = re.sub(r"\d+[a-zа-я]?", " ", tmp)
    # Нормализуем пунктуацию: "-а", "/б" и т.п. превращаем в отдельные токены.
    tmp = re.sub(r"[^a-zа-я0-9]+", " ", tmp, flags=re.I)
    tmp = re.sub(r"\s+", " ", tmp).strip()
    if not tmp:
        return False
    # После вырезания номера дома иногда остаётся только буква дома: "б".
    # Это не улица, в таком случае улицу нужно брать из предыдущего сегмента.
    tokens = [t for t in tmp.split() if not re.fullmatch(r"[a-zа-я]", t)]
    tmp2 = " ".join(tokens).strip()
    if not tmp2:
        return False
    return bool(re.search(r"[a-zа-я]", tmp2))


def _make_street_keys(street_zone: str):
    src = normalize_street_part(street_zone)
    src = re.sub(r"\s+", " ", src).strip()

    tokens = []
    for t in src.split():
        if t in _STREET_TYPE_TOKENS:
            continue
        if t in _STREET_DROP_TOKENS:
            continue
        # убираем технические куски типа "к1", "стр2", если вдруг прилипли к street_zone
        if re.fullmatch(r"(?:к|стр)\d+[a-zа-я]?", t):
            continue
        tokens.append(t)

    street_key = " ".join(tokens).strip()
    # bag-ключ ловит перестановки типа "маршала казакова ул" vs "ул маршала казакова"
    street_key_bag = " ".join(sorted(tokens)).strip()
    return street_key, street_key_bag


def extract_components(address: str | None):
    """
    Возвращает структуру:
    {
      street_key,
      street_key_bag,
      house_from,
      house_to,
      house_letter,
      corp,
      str,
      norm
    }
    """
    if not address:
        return None

    raw = address
    a = normalize_street_part(norm_text(raw))
    # Разлепляем компактные записи: 70к1с1 -> 70 к1 с1
    a = re.sub(r"(\d)\s*к\s*(\d)", r"\1 к\2", a, flags=re.I)
    a = re.sub(r"(\d)\s*с\s*(\d)", r"\1 с\2", a, flags=re.I)

    parts = [p.strip() for p in a.split(",") if p.strip()]
    house_data = None
    street_zone = a

    if len(parts) >= 2:
        # Обычно дом в последнем куске после последней запятой
        last = parts[-1]
        house_data = _parse_house_from_segment(last, prefer_first=True)

        if house_data:
            # Если в последнем куске есть название улицы ("октябрьская д8") — берём его,
            # иначе улица в предыдущем куске ("..., ул ..., 18")
            stripped_last = _remove_house_from_segment(last, house_data["span"])
            if _has_real_street_words(stripped_last):
                street_zone = stripped_last
            else:
                street_zone = parts[-2]
        else:
            # Фоллбек: бывает всё в одном куске, либо странный формат
            house_data = _parse_house_from_segment(a, prefer_first=False)
            if house_data:
                street_zone = _remove_house_from_segment(a, house_data["span"])
    else:
        # Без запятых чаще корректнее брать ПОСЛЕДНИЙ номер ("невский пр 126", "25 октября пр 37а")
        house_data = _parse_house_from_segment(a, prefer_first=False)
        if house_data:
            street_zone = _remove_house_from_segment(a, house_data["span"])

    if not house_data:
        house_from = house_to = None
        house_letter = ""
        corp = None
        stro = None
    else:
        house_from = house_data["house_from"]
        house_to = house_data["house_to"]
        house_letter = house_data["house_letter"]
        corp = house_data["corp"]
        stro = house_data["str"]

    street_key, street_key_bag = _make_street_keys(street_zone)

    return {
        "raw": raw,
        "norm": a,
        "street_key": street_key,
        "street_key_bag": street_key_bag,
        "house_from": house_from,
        "house_to": house_to,
        "house_letter": house_letter,
        "corp": corp,
        "str": stro,
    }


def houses_overlap(a, b) -> bool:
    """
    Совпадение дома с учётом диапазонов:
    105-107 совпадает с 105
    7-9 совпадает с 7
    """
    if a["house_from"] is None or b["house_from"] is None:
        return False
    a1, a2 = a["house_from"], a["house_to"]
    b1, b2 = b["house_from"], b["house_to"]
    return not (a2 < b1 or b2 < a1)


def part_relation(comp_a, comp_b, field: str):
    """
    Универсально для corp/str:
    - ok: совпали или оба пустые
    - unknown: заполнено только с одной стороны
    - mismatch: обе стороны заполнены и разные
    """
    va = (comp_a.get(field) or "").strip().lower()
    vb = (comp_b.get(field) or "").strip().lower()
    if not va and not vb:
        return "ok"
    if va and vb and va == vb:
        return "ok"
    if va and vb and va != vb:
        return "mismatch"
    return "unknown"


# ====== ПАРСИНГ КОНКУРЕНТА ======
def get_title_from_card(card):
    if card.locator("a.product-item-name").count() > 0:
        t = clean_text(card.locator("a.product-item-name").first.inner_text())
        if t:
            return t

    if card.locator("div.product-item__more").count() > 0:
        t = clean_text(card.locator("div.product-item__more").first.inner_text())
        if t:
            t = t.replace("На карте", "").strip()
            parts = [p.strip() for p in t.split("\n") if p.strip()]
            if parts:
                return parts[0]
    return None


PRO_DETECT_JS = r"""
async (img) => {
  if (!img) return {has: false, reason: "no_img"};

  let srcImg = img;
  let w0 = img.naturalWidth || img.width;
  let h0 = img.naturalHeight || img.height;

  if (!w0 || !h0) {
    const srcRaw =
      img.currentSrc ||
      img.getAttribute("src") ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-lazy") ||
      "";
    if (!srcRaw) return {has: false, reason: "no_size"};

    const srcAbs = new URL(srcRaw, location.href).toString();
    const probe = new Image();
    probe.crossOrigin = "anonymous";
    try {
      await new Promise((resolve, reject) => {
        probe.onload = () => resolve(true);
        probe.onerror = () => reject(new Error("img_load_error"));
        probe.src = srcAbs;
      });
    } catch (e) {
      return {has: false, reason: "load_fail"};
    }
    w0 = probe.naturalWidth || probe.width;
    h0 = probe.naturalHeight || probe.height;
    if (!w0 || !h0) return {has: false, reason: "no_size"};
    srcImg = probe;
  }

  const w = 360;
  const h = Math.max(1, Math.round((h0 / w0) * w));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  try {
    ctx.drawImage(srcImg, 0, 0, w, h);
  } catch (e) {
    return {has: false, reason: "draw_fail"};
  }

  const d = ctx.getImageData(0, 0, w, h).data;
  const x1 = Math.floor(w * 0.22), x2 = Math.floor(w * 0.78);
  const y1 = Math.floor(h * 0.08), y2 = Math.floor(h * 0.55);

  // Маска "желтовато-зеленого" полупрозрачного круга на синем фоне.
  const mask = new Uint8Array(w * h);
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const i = (y * w + x) * 4;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const v = r + g - 1.25 * b;
      if (v > 110 && (g - b) > 15 && (r - b) > 5 && g > 120) mask[y * w + x] = 1;
    }
  }

  const seen = new Uint8Array(w * h);
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  let best = null;

  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const idx = y * w + x;
      if (!mask[idx] || seen[idx]) continue;

      let q = [idx], qi = 0;
      let area = 0, minx = x, maxx = x, miny = y, maxy = y;
      let sr = 0, sg = 0, sb = 0;
      seen[idx] = 1;

      while (qi < q.length) {
        const id = q[qi++];
        const cx = id % w, cy = (id / w) | 0;
        area++;

        const ii = (cy * w + cx) * 4;
        sr += d[ii];
        sg += d[ii + 1];
        sb += d[ii + 2];

        if (cx < minx) minx = cx;
        if (cx > maxx) maxx = cx;
        if (cy < miny) miny = cy;
        if (cy > maxy) maxy = cy;

        for (const [dx, dy] of dirs) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < x1 || nx >= x2 || ny < y1 || ny >= y2) continue;
          const nid = ny * w + nx;
          if (mask[nid] && !seen[nid]) {
            seen[nid] = 1;
            q.push(nid);
          }
        }
      }

      const bw = maxx - minx + 1, bh = maxy - miny + 1;
      const ratio = bw / bh;
      const fill = area / (bw * bh);
      const af = area / (w * h);
      const cxn = (minx + maxx) / 2 / w;
      const cyn = (miny + maxy) / 2 / h;
      const mr = sr / area, mg = sg / area, mb = sb / area;

      // Геометрия похожа на круг + типичная позиция watermark + цвет.
      if (!(af > 0.004 && af < 0.03 && ratio > 0.75 && ratio < 1.35 && fill > 0.50)) continue;
      if (!(cxn > 0.45 && cxn < 0.73 && cyn > 0.16 && cyn < 0.42)) continue;
      if (!((mg - mb) > 18 && (mr - mb) > 8)) continue;

      const cand = {area, bw, bh, ratio, fill, af, cxn, cyn, mr, mg, mb};
      if (!best || cand.area > best.area) best = cand;
    }
  }

  if (!best) return {has: false, reason: "none"};
  return {has: true, reason: "component", score: Math.round(best.area), best};
}
"""


def detect_pro_watermark(card):
    """
    Возвращает:
    - pro_mark: yes/no/unknown
    - pro_note: краткая причина/метод
    """
    try:
        img = card.locator("img").first
        if img.count() == 0:
            return "unknown", "no_img"
        res = img.evaluate(PRO_DETECT_JS)
        if isinstance(res, dict) and res.get("has"):
            return "yes", "pixel_heuristic"
        if isinstance(res, dict):
            return "no", str(res.get("reason") or "none")
        return "unknown", "unexpected_result"
    except Exception:
        return "unknown", "eval_error"


def parse_one_knru_page(page, page_num: int, rank_start: int, base_url: str):
    page.wait_for_selector("div.product-item-container", timeout=60_000)
    cards = page.locator("div.product-item-container")
    total = cards.count()
    rows = []
    rank = rank_start

    for i in range(total):
        card = cards.nth(i)
        rank += 1

        # URL
        url = None
        a_catalog = card.locator('a[href^="/catalog/"]').first
        if a_catalog.count() > 0:
            href = a_catalog.get_attribute("href")
            if href:
                url = base_url + href

        title = get_title_from_card(card)

        # Адрес
        address = None
        if card.locator("div.product-item__adress span").count() > 0:
            address = clean_text(card.locator("div.product-item__adress span").first.inner_text())
        elif card.locator("div.product-item__adress").count() > 0:
            address = clean_text(card.locator("div.product-item__adress").first.inner_text())
        if address:
            address = address.replace("На карте", "").strip()

        # Район
        district = None
        if card.locator("div.district__title").count() > 0:
            district = clean_text(card.locator("div.district__title").first.inner_text())
        elif card.locator("a.district").count() > 0:
            district = clean_text(card.locator("a.district").first.inner_text())

        # Цена
        price_txt = clean_text(card.locator("div.product-item__price").first.inner_text()) if card.locator("div.product-item__price").count() else None
        price_rub = extract_first_number(price_txt)

        # Площадь
        area_txt = clean_text(card.locator("div.square__title").first.inner_text()) if card.locator("div.square__title").count() else None
        area_m2 = extract_first_number(area_txt)
        listing_id = extract_listing_id(url)
        pro_mark, pro_note = detect_pro_watermark(card)

        rows.append(
            {
                "deal_type": "sale",  # на knru commercial сейчас это фактически продажа
                "title": title,
                "address": address,
                "district": district,
                "price_rub": price_rub,
                "area_m2": area_m2,
                "competitor_url": url,
                "competitor_listing_id": listing_id,
                "page_num": page_num,
                "page_pos": i + 1,
                "position_global": rank,
                "pro_mark": pro_mark,
                "pro_note": pro_note,
            }
        )

    return rows, rank


def get_last_page_num_knru(page) -> int:
    # ищем цифры пагинации
    nums = []
    loc = page.locator("a.pagination__el")
    for i in range(loc.count()):
        t = clean_text(loc.nth(i).inner_text())
        if t and t.isdigit():
            nums.append(int(t))
    return max(nums) if nums else 1


def parse_all_knru_pages(page, start_url: str, base_url: str):
    # первая страница
    rows_all = []
    rank = 0
    first_rows, rank = parse_one_knru_page(page, page_num=1, rank_start=rank, base_url=base_url)
    rows_all.extend(first_rows)

    last_page = get_last_page_num_knru(page)
    if last_page <= 1:
        return rows_all

    for n in range(2, last_page + 1):
        url = f"{start_url}?PAGEN_1={n}"
        page.goto(url, wait_until="domcontentloaded", timeout=120_000)
        page_rows, rank = parse_one_knru_page(page, page_num=n, rank_start=rank, base_url=base_url)
        rows_all.extend(page_rows)

    return rows_all


# ====== ПАРСИНГ КОНКУРЕНТА (NORDWEST) ======
def extract_listing_id_from_slug(url: str | None) -> str:
    if not url:
        return ""
    m = re.search(r"/real-estates/([^/?#]+)", str(url))
    return (m.group(1) if m else "").strip()


def extract_nordwest_listing_id(card, url: str | None) -> str:
    img = card.locator(".header .img img").first
    if img.count() > 0:
        src = img.get_attribute("src") or ""
        m = re.search(r"/real-estate-grid/(\d+)-", src)
        if m:
            return m.group(1)
    return extract_listing_id_from_slug(url)


def parse_one_nordwest_card(card, position_global: int, base_url: str):
    title = clean_text(card.locator(".name a").first.inner_text()) if card.locator(".name a").count() > 0 else None

    url = None
    if card.locator("a.more.button").count() > 0:
        url = card.locator("a.more.button").first.get_attribute("href")
    if not url and card.locator(".name a").count() > 0:
        url = card.locator(".name a").first.get_attribute("href")
    if url and url.startswith("/"):
        url = base_url + url

    address = clean_text(card.locator(".field-name.icon").first.inner_text()) if card.locator(".field-name.icon").count() > 0 else None

    # В карточках Nordwest отдельного поля района обычно нет.
    district = None

    price_txt = clean_text(card.locator(".info-footer .price .value").first.inner_text()) if card.locator(".info-footer .price .value").count() else None
    price_rub = extract_first_number(price_txt)

    area_m2 = None
    fields = card.locator(".fields .field")
    for j in range(fields.count()):
        f = fields.nth(j)
        lbl = clean_text(f.locator(".label").first.inner_text()) if f.locator(".label").count() else ""
        if lbl and "площад" in lbl.lower():
            val = clean_text(f.locator(".value").first.inner_text()) if f.locator(".value").count() else None
            area_m2 = extract_first_number(val)
            break

    listing_id = extract_nordwest_listing_id(card, url)

    return {
        "deal_type": "sale",
        "title": title,
        "address": address,
        "district": district,
        "price_rub": price_rub,
        "area_m2": area_m2,
        "competitor_url": url,
        "competitor_listing_id": listing_id,
        "page_num": 1,
        "page_pos": position_global,
        "position_global": position_global,
        "pro_mark": "no",
        "pro_note": "nordwest_no_npro_scan",
    }


def expand_nordwest_catalog(page, max_clicks: int = 300):
    clicks = 0
    while clicks < max_clicks:
        btn = page.locator('a[wire\\:click\\.prevent="load"]').first
        if btn.count() == 0:
            break
        try:
            if not btn.is_visible():
                break
        except Exception:
            break

        prev = page.locator(".real-estates-grid-item").count()
        try:
            btn.scroll_into_view_if_needed(timeout=5_000)
            btn.click(timeout=15_000)
            page.wait_for_function(
                '(p) => document.querySelectorAll(".real-estates-grid-item").length > p',
                arg=prev,
                timeout=30_000,
            )
        except PlaywrightTimeoutError:
            break
        except Exception:
            break

        cur = page.locator(".real-estates-grid-item").count()
        if cur <= prev:
            break
        clicks += 1


def parse_all_nordwest_pages(page, start_url: str, base_url: str):
    page.goto(start_url, wait_until="domcontentloaded", timeout=120_000)
    page.wait_for_selector(".real-estates-grid-item", timeout=120_000)

    expand_nordwest_catalog(page, max_clicks=500)

    cards = page.locator(".real-estates-grid-item")
    total = cards.count()

    rows = []
    for i in range(total):
        card = cards.nth(i)
        row = parse_one_nordwest_card(card, position_global=i + 1, base_url=base_url)
        rows.append(row)
    return rows


def _collect_text_from_node(node):
    parts = [x.strip() for x in node.xpath(".//text()") if str(x).strip()]
    return " ".join(parts).strip()


def parse_rest2rent_html(html_text: str, base_url: str, source_note: str):
    try:
        from lxml import html as lxml_html
    except Exception:
        return []

    try:
        doc = lxml_html.fromstring(html_text)
    except Exception:
        return []

    rows = []
    rank = 0

    for section_id, deal_type in (("аренда", "rent"), ("продажа", "sale")):
        sec = doc.xpath(f'//*[@id="{section_id}"]')
        if not sec:
            continue
        section_node = sec[0]
        cards = section_node.xpath('.//div[contains(@class, "widget-element")]')

        for card in cards:
            links = card.xpath('.//a[contains(@href, "rest2rent.yucrm.ru/s/")]/@href')
            if not links:
                continue
            url = absolute_url(base_url, links[0])
            listing_id = extract_listing_id_from_tail(url, r"/s/([^/?#]+)")

            text_nodes = card.xpath('.//div[contains(@class, "widget-text")]')
            texts = []
            for n in text_nodes:
                t = _collect_text_from_node(n)
                if t:
                    texts.append(t)
            if not texts:
                continue

            address = texts[0]
            details = texts[1] if len(texts) > 1 else ""
            area_m2, price_rub = parse_area_and_price_text(details)

            rank += 1
            rows.append(
                {
                    "deal_type": deal_type,
                    "title": address,
                    "address": address,
                    "district": None,
                    "price_rub": price_rub,
                    "area_m2": area_m2,
                    "competitor_url": url,
                    "competitor_listing_id": listing_id,
                    "page_num": 1,
                    "page_pos": rank,
                    "position_global": rank,
                    "pro_mark": "no",
                    "pro_note": source_note,
                }
            )

    return rows


def parse_all_rest2rent_pages(start_url: str, base_url: str, rest2rent_html: str | None = None):
    html_sources = []
    errors = []

    if rest2rent_html:
        local = load_text_if_exists(Path(rest2rent_html))
        if local:
            html_sources.append(("rest2rent_local_html", local))
        else:
            errors.append(f"local_html_not_found:{rest2rent_html}")

    try:
        live_html = fetch_text(start_url, timeout_sec=90)
        html_sources.append(("rest2rent_live", live_html))
    except urllib.error.URLError as e:
        errors.append(f"url_error:{e}")
    except Exception as e:
        errors.append(f"fetch_error:{e}")

    cache_candidates = [Path("/private/tmp/rest2rent_live.html"), Path("/private/tmp/rest2rent.html"), Path("/tmp/rest2rent.html")]
    for cache_path in cache_candidates:
        cached = load_text_if_exists(cache_path)
        if cached:
            html_sources.append((f"rest2rent_cache:{cache_path}", cached))
            break

    for source_name, html_text in html_sources:
        rows = parse_rest2rent_html(html_text, base_url=base_url, source_note=source_name)
        if rows:
            return rows
        errors.append(f"{source_name}:no_cards")

    if errors:
        print("Rest2rent parse warnings:")
        for e in errors:
            print("-", e)
    return []


def fetch_text(url: str, timeout_sec: int = 60, extra_headers: dict | None = None):
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/126.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    if extra_headers:
        headers.update({k: v for k, v in extra_headers.items() if v})

    req = urllib.request.Request(
        url,
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read()
            enc = resp.headers.get_content_charset() or "utf-8"
            return raw.decode(enc, errors="ignore")
    except urllib.error.URLError as e:
        # На некоторых macOS-окружениях Python не видит системный trust store.
        # Для парсинга публичных страниц используем fallback без проверки сертификата.
        reason = getattr(e, "reason", None)
        if isinstance(reason, ssl.SSLCertVerificationError):
            ctx = ssl._create_unverified_context()
            with urllib.request.urlopen(req, timeout=timeout_sec, context=ctx) as resp:
                raw = resp.read()
                enc = resp.headers.get_content_charset() or "utf-8"
                return raw.decode(enc, errors="ignore")
        raise


def parse_bbox_from_url(url: str):
    try:
        pu = urllib.parse.urlparse(url)
        q = urllib.parse.parse_qs(pu.query)
        left = float(q.get("leftLongitude", [None])[0])
        right = float(q.get("rightLongitude", [None])[0])
        bottom = float(q.get("bottomLatitude", [None])[0])
        top = float(q.get("topLatitude", [None])[0])
    except Exception:
        return None
    if not (left < right and bottom < top):
        return None
    return {"left": left, "right": right, "bottom": bottom, "top": top}


def build_url_with_bbox(url: str, bbox: dict):
    pu = urllib.parse.urlparse(url)
    q = urllib.parse.parse_qs(pu.query)
    q["leftLongitude"] = [f"{bbox['left']:.6f}"]
    q["rightLongitude"] = [f"{bbox['right']:.6f}"]
    q["bottomLatitude"] = [f"{bbox['bottom']:.6f}"]
    q["topLatitude"] = [f"{bbox['top']:.6f}"]
    new_q = urllib.parse.urlencode(q, doseq=True)
    return urllib.parse.urlunparse((pu.scheme, pu.netloc, pu.path, pu.params, new_q, pu.fragment))


def split_bbox_4(bbox: dict):
    mx = (bbox["left"] + bbox["right"]) / 2.0
    my = (bbox["bottom"] + bbox["top"]) / 2.0
    return [
        {"left": bbox["left"], "right": mx, "bottom": bbox["bottom"], "top": my},
        {"left": mx, "right": bbox["right"], "bottom": bbox["bottom"], "top": my},
        {"left": bbox["left"], "right": mx, "bottom": my, "top": bbox["top"]},
        {"left": mx, "right": bbox["right"], "bottom": my, "top": bbox["top"]},
    ]


def bbox_too_small(bbox: dict, min_lon_span: float = 0.02, min_lat_span: float = 0.02):
    return (bbox["right"] - bbox["left"]) < min_lon_span or (bbox["top"] - bbox["bottom"]) < min_lat_span


def is_yandex_captcha_html(html: str):
    h = (html or "").lower()
    return ("вы не робот" in h) or ("checkcaptcha" in h) or ("smartcaptcha" in h)


def extract_yandex_initial_state(html: str):
    if not html:
        return None
    m = re.search(r"window\.INITIAL_STATE\s*=\s*(\{.*?\})\s*;\s*</script>", html, flags=re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception:
        return None


def load_text_if_exists(path: Path):
    if not path.exists():
        return None
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return None


def parse_yandex_entity(entity: dict, idx: int, base_url: str, source_note: str):
    offer_id = entity.get("offerId")
    url = absolute_url(base_url, entity.get("url"))
    location = entity.get("location") or {}
    address = clean_text(location.get("address") or location.get("streetAddress"))

    deal_map = {"SELL": "sale", "RENT": "rent"}
    deal_type = deal_map.get(str(entity.get("offerType") or "").upper(), "sale")

    price_rub = None
    price_obj = entity.get("price") or {}
    if isinstance(price_obj.get("value"), (int, float)):
        price_rub = price_obj.get("value")

    area_m2 = None
    area_obj = entity.get("area") or {}
    if isinstance(area_obj.get("value"), (int, float)):
        area_m2 = area_obj.get("value")

    title = clean_text(entity.get("description")) or address
    listing_id = str(offer_id) if offer_id is not None else extract_listing_id(url)

    return {
        "deal_type": deal_type,
        "title": title,
        "address": address,
        "district": None,
        "price_rub": price_rub,
        "area_m2": area_m2,
        "competitor_url": url,
        "competitor_listing_id": listing_id,
        "page_num": 1,
        "page_pos": idx,
        "position_global": idx,
        "pro_mark": "no",
        "pro_note": source_note,
    }


def parse_yandex_entities(state: dict, base_url: str, source_note: str):
    offers = ((state.get("map") or {}).get("offers") or {}).get("items") or {}
    entities = offers.get("entities") or []
    total = offers.get("total")
    try:
        total = int(total) if total is not None else len(entities)
    except Exception:
        total = len(entities)
    rows = []
    for i, entity in enumerate(entities, 1):
        if not isinstance(entity, dict):
            continue
        row = parse_yandex_entity(entity, i, base_url=base_url, source_note=source_note)
        rows.append(row)
    return rows, total, len(entities)


def parse_all_yandex_map(
    start_url: str,
    base_url: str,
    yandex_html: str | None = None,
    yandex_cookie: str | None = None,
    max_depth: int = 2,
    max_tiles: int = 120,
    delay_ms: int = 900,
):
    extra_headers = {"Referer": "https://realty.yandex.ru/"}
    if yandex_cookie:
        extra_headers["Cookie"] = yandex_cookie

    def fetch_state(url: str, retries: int = 2):
        last_err = ""
        for attempt in range(retries + 1):
            try:
                html = fetch_text(url, timeout_sec=90, extra_headers=extra_headers)
            except urllib.error.URLError as e:
                last_err = f"url_error:{e}"
                time.sleep(0.6 + attempt * 0.5)
                continue
            except Exception as e:
                last_err = f"fetch_error:{e}"
                time.sleep(0.6 + attempt * 0.5)
                continue

            state = extract_yandex_initial_state(html)
            if state:
                return state, "ok"
            if is_yandex_captcha_html(html):
                last_err = "captcha"
            else:
                last_err = "no_initial_state"
            time.sleep(0.6 + attempt * 0.5)
        return None, last_err or "unknown"

    def assign_positions(rows):
        for i, row in enumerate(rows, 1):
            row["position_global"] = i
            row["page_pos"] = i
        return rows

    seen = set()
    out_rows = []
    warnings = []

    def merge_rows(rows):
        for r in rows:
            key = (r.get("competitor_listing_id") or "").strip() or (r.get("competitor_url") or "").strip()
            if not key or key in seen:
                continue
            seen.add(key)
            out_rows.append(r)

    # 1) Пробуем live root.
    root_state, root_status = fetch_state(start_url, retries=2)
    root_total = None
    root_len = None
    if root_state:
        root_rows, root_total, root_len = parse_yandex_entities(root_state, base_url=base_url, source_note="yandex_root")
        merge_rows(root_rows)
    else:
        warnings.append(f"root:{root_status}")

    # 2) Тайловый сбор, если root ограничен (обычно 20) и bbox доступен.
    bbox = parse_bbox_from_url(start_url)
    tile_stats = {"tiles": 0, "captchas": 0, "fail": 0}

    def walk(b: dict, depth: int):
        nonlocal tile_stats
        if tile_stats["tiles"] >= max_tiles:
            return
        if depth > max_depth:
            return
        if bbox_too_small(b):
            return

        tile_url = build_url_with_bbox(start_url, b)
        # Небольшая задержка и джиттер, чтобы не триггерить антибот слишком быстро.
        time.sleep(max(0.0, delay_ms / 1000.0) + random.uniform(0.0, 0.35))
        state, status = fetch_state(tile_url, retries=1)
        tile_stats["tiles"] += 1

        if not state:
            if status == "captcha":
                tile_stats["captchas"] += 1
            else:
                tile_stats["fail"] += 1
            return

        rows, total, count = parse_yandex_entities(state, base_url=base_url, source_note=f"yandex_tile_d{depth}")
        merge_rows(rows)

        # Сплитим только когда явно упираемся в лимит карточек.
        if depth < max_depth and total and count and total > count and count >= 8:
            for sub in split_bbox_4(b):
                walk(sub, depth + 1)

    if bbox and root_total and root_len and root_total > root_len and max_depth > 0:
        for sub in split_bbox_4(bbox):
            walk(sub, depth=1)

    # 3) Фоллбеки из локальных HTML, если live дал 0.
    if not out_rows:
        html_sources = []
        if yandex_html:
            local = load_text_if_exists(Path(yandex_html))
            if local:
                html_sources.append(("yandex_local_html", local))
            else:
                warnings.append(f"local_html_not_found:{yandex_html}")

        cache_candidates = [Path("/private/tmp/yandex_map.html"), Path("/tmp/yandex_map.html")]
        for cache_path in cache_candidates:
            cached = load_text_if_exists(cache_path)
            if cached:
                html_sources.append((f"yandex_cache:{cache_path}", cached))
                break

        for source_name, html in html_sources:
            state = extract_yandex_initial_state(html)
            if not state:
                if is_yandex_captcha_html(html):
                    warnings.append(f"{source_name}:captcha")
                else:
                    warnings.append(f"{source_name}:no_initial_state")
                continue
            rows, _, _ = parse_yandex_entities(state, base_url=base_url, source_note=source_name)
            merge_rows(rows)
            if out_rows:
                break

    if warnings:
        print("Yandex map parse warnings:")
        for e in warnings:
            print("-", e)

    if root_total is not None:
        print(
            "Yandex map coverage:",
            f"root_total={root_total}",
            f"root_entities={root_len}",
            f"unique_collected={len(out_rows)}",
            f"tiles={tile_stats['tiles']}",
            f"captchas={tile_stats['captchas']}",
            f"tile_fail={tile_stats['fail']}",
        )
    return assign_positions(out_rows)


# ====== ПАРСИНГ ВАШЕГО XML ======
def parse_my_xml(xml_path: Path):
    # пробуем lxml (лучше терпит мусор)
    try:
        from lxml import etree

        parser = etree.XMLParser(recover=True, huge_tree=True)
        tree = etree.parse(str(xml_path), parser)
        root = tree.getroot()

        items = []
        for it in root.findall(".//item"):
            deal_type = (it.findtext("deal_type") or "").strip()
            status = (it.findtext("status") or "").strip()
            address = (it.findtext("address") or "").strip()
            square = it.findtext("square")
            price = it.findtext("price")
            crm_url = (it.findtext("crm_url") or "").strip()

            area_m2 = extract_first_number(square)
            price_rub = extract_first_number(price)

            if not address:
                continue

            items.append(
                {
                    "deal_type": deal_type,
                    "status": status,
                    "address": address,
                    "area_m2": area_m2,
                    "price_rub": price_rub,
                    "crm_url": crm_url,
                }
            )
        return items

    except Exception:
        # fallback
        import xml.etree.ElementTree as ET

        tree = ET.parse(str(xml_path))
        root = tree.getroot()
        items = []
        for it in root.findall(".//item"):
            deal_type = (it.findtext("deal_type") or "").strip()
            status = (it.findtext("status") or "").strip()
            address = (it.findtext("address") or "").strip()
            square = it.findtext("square")
            price = it.findtext("price")
            crm_url = (it.findtext("crm_url") or "").strip()

            area_m2 = extract_first_number(square)
            price_rub = extract_first_number(price)

            if not address:
                continue

            items.append(
                {
                    "deal_type": deal_type,
                    "status": status,
                    "address": address,
                    "area_m2": area_m2,
                    "price_rub": price_rub,
                    "crm_url": crm_url,
                }
            )
        return items


# ====== СРАВНЕНИЕ ======
def build_my_index(my_items):
    """
    Индекс по street_key и street_key_bag -> список объектов.
    """
    idx = {}
    for it in my_items:
        comp = extract_components(it["address"])
        if not comp:
            continue
        it["_comp"] = comp

        k1 = comp["street_key"]
        k2 = comp["street_key_bag"]

        if k1:
            idx.setdefault(k1, []).append(it)
        if k2 and k2 != k1:
            idx.setdefault(k2, []).append(it)
    return idx


def describe_my_item(it):
    """
    Формат для reason:
    "Архив sale 160 м² 112 000 000 ссылка"
    """
    st = it.get("status") or ""
    dt = it.get("deal_type") or ""
    area = it.get("area_m2")
    price = it.get("price_rub")
    link = hyperlink(it.get("crm_url"), "ссылка")
    area_s = f"{area:.1f}".rstrip("0").rstrip(".") if isinstance(area, (int, float)) else ""
    price_s = format_int_spaces(price)
    parts = []
    if st:
        parts.append(st)
    if dt:
        parts.append(dt)
    if area_s:
        parts.append(f"{area_s} м²")
    if price_s:
        parts.append(price_s)
    if link:
        parts.append(link)
    return " ".join(parts).strip()


def _unique_items(items):
    seen = set()
    out = []
    for x in items:
        key = (x.get("crm_url"), x.get("address"), x.get("area_m2"), x.get("price_rub"))
        if key in seen:
            continue
        seen.add(key)
        out.append(x)
    return out


def _pick_reference_price(items, comp_deal: str):
    """
    Для сравнения цен:
    - в приоритете наш объект того же типа сделки
    - затем fallback на любой тип
    Возвращает (price, item, scope)
    """
    if not items:
        return None, None, ""

    comp_deal_norm = str(comp_deal or "").strip().lower()
    same_deal_prices = [
        x for x in items if x.get("deal_type") == comp_deal_norm and isinstance(x.get("price_rub"), (int, float))
    ]
    sale_prices = [x for x in items if x.get("deal_type") == "sale" and isinstance(x.get("price_rub"), (int, float))]
    rent_prices = [x for x in items if x.get("deal_type") == "rent" and isinstance(x.get("price_rub"), (int, float))]
    any_prices = [x for x in items if isinstance(x.get("price_rub"), (int, float))]

    if same_deal_prices:
        pool = same_deal_prices
        scope = "same_deal"
    elif comp_deal_norm == "sale" and sale_prices:
        pool = sale_prices
        scope = "sale_only"
    elif comp_deal_norm == "rent" and rent_prices:
        pool = rent_prices
        scope = "rent_only"
    else:
        pool = any_prices
        scope = "any_type"

    if not pool:
        return None, None, ""

    best_item = min(pool, key=lambda x: float(x["price_rub"]))
    return float(best_item["price_rub"]), best_item, scope


def _build_price_alert(comp_price, my_price):
    """
    Возвращает:
    - price_alert (строка)
    - delta_rub (my - comp)
    - delta_pct (my vs comp)
    """
    if not isinstance(comp_price, (int, float)) or not isinstance(my_price, (int, float)):
        return "", None, None
    if float(comp_price) <= 0:
        return "", None, None

    delta = float(my_price) - float(comp_price)
    pct = (delta / float(comp_price)) * 100.0

    if delta > 0:
        alert = f"У нас дороже на {format_int_spaces(delta)} ({pct:.1f}%)"
    elif delta < 0:
        alert = f"У нас дешевле на {format_int_spaces(abs(delta))} ({abs(pct):.1f}%)"
    else:
        alert = "Цена равна"
    return alert, delta, pct


def compare_one(comp_row, my_index):
    """
    Возвращает словарь с результатом сравнения.
    """
    comp_addr = comp_row.get("address")
    comp_area = comp_row.get("area_m2")
    comp_price = comp_row.get("price_rub")
    comp_deal = str(comp_row.get("deal_type") or "").strip().lower()

    comp_comp = extract_components(comp_addr)
    if not comp_comp or (not comp_comp["street_key"] and not comp_comp["street_key_bag"]):
        return {
            "result": "Нет у нас",
            "reason": "Адрес не разобран",
            "our_best_price_rub": None,
            "our_best_link": "",
            "price_scope": "",
            "price_alert": "",
            "price_diff_rub": None,
            "price_diff_pct": None,
            "matched_count": 0,
        }

    # Достаём кандидатов по двум ключам
    candidates = []
    if comp_comp["street_key"]:
        candidates.extend(my_index.get(comp_comp["street_key"], []))
    if comp_comp["street_key_bag"]:
        candidates.extend(my_index.get(comp_comp["street_key_bag"], []))
    candidates = _unique_items(candidates)

    # фильтр по дому/диапазону
    candidates = [c for c in candidates if houses_overlap(comp_comp, c["_comp"])]

    if not candidates:
        return {
            "result": "Нет у нас",
            "reason": "Совпадений по улице+дому не найдено",
            "our_best_price_rub": None,
            "our_best_link": "",
            "price_scope": "",
            "price_alert": "",
            "price_diff_rub": None,
            "price_diff_pct": None,
            "matched_count": 0,
        }

    # корпус/строение
    same_house = []
    part_mismatch = []
    for c in candidates:
        corp_rel = part_relation(comp_comp, c["_comp"], "corp")
        str_rel = part_relation(comp_comp, c["_comp"], "str")
        if corp_rel == "mismatch" or str_rel == "mismatch":
            part_mismatch.append(c)
        else:
            same_house.append(c)

    def area_diff(c):
        if comp_area is None or c.get("area_m2") is None:
            return 10**9
        return abs(float(comp_area) - float(c["area_m2"]))

    # если все отвалились по корпусу/строению
    if not same_house and part_mismatch:
        all_found = sorted(part_mismatch, key=area_diff)
        listing = " | ".join(describe_my_item(x) for x in all_found[:12])
        ref_price, ref_item, scope = _pick_reference_price(all_found, comp_deal)
        alert, delta_rub, delta_pct = _build_price_alert(comp_price, ref_price)
        return {
            "result": "Корпус/строение не совпало",
            "reason": listing,
            "our_best_price_rub": ref_price,
            "our_best_link": hyperlink(ref_item.get("crm_url"), "ссылка") if ref_item else "",
            "price_scope": scope,
            "price_alert": alert,
            "price_diff_rub": delta_rub,
            "price_diff_pct": delta_pct,
            "matched_count": len(all_found),
        }

    same_house_sorted = sorted(same_house, key=area_diff)

    # если нет близких по площади, но дом тот же
    close = [c for c in same_house_sorted if area_diff(c) <= AREA_TOL]
    if not close:
        listing = " | ".join(describe_my_item(x) for x in same_house_sorted[:12])
        ref_price, ref_item, scope = _pick_reference_price(same_house_sorted, comp_deal)
        alert, delta_rub, delta_pct = _build_price_alert(comp_price, ref_price)
        return {
            "result": "По адресу есть, но площадь другая",
            "reason": listing,
            "our_best_price_rub": ref_price,
            "our_best_link": hyperlink(ref_item.get("crm_url"), "ссылка") if ref_item else "",
            "price_scope": scope,
            "price_alert": alert,
            "price_diff_rub": delta_rub,
            "price_diff_pct": delta_pct,
            "matched_count": len(same_house_sorted),
        }

    # есть близкие по площади — считаем совпадением адрес+площадь
    close_listing = " | ".join(describe_my_item(x) for x in close[:12])
    ref_price, ref_item, scope = _pick_reference_price(close, comp_deal)
    alert, delta_rub, delta_pct = _build_price_alert(comp_price, ref_price)

    has_sale = any((x.get("deal_type") == "sale") for x in close)
    has_rent = any((x.get("deal_type") == "rent") for x in close)

    if comp_deal == "sale" and (not has_sale) and has_rent:
        return {
            "result": "У нас аренда, у конкурента продажа",
            "reason": close_listing,
            "our_best_price_rub": ref_price,
            "our_best_link": hyperlink(ref_item.get("crm_url"), "ссылка") if ref_item else "",
            "price_scope": scope,
            "price_alert": alert,
            "price_diff_rub": delta_rub,
            "price_diff_pct": delta_pct,
            "matched_count": len(close),
        }

    return {
        "result": "Совпало",
        "reason": close_listing,
        "our_best_price_rub": ref_price,
        "our_best_link": hyperlink(ref_item.get("crm_url"), "ссылка") if ref_item else "",
        "price_scope": scope,
        "price_alert": alert,
        "price_diff_rub": delta_rub,
        "price_diff_pct": delta_pct,
        "matched_count": len(close),
    }


def build_report(comp_rows, my_items):
    my_index = build_my_index(my_items)

    out = []
    for r in comp_rows:
        cmp = compare_one(r, my_index)
        competitor_price = r.get("price_rub")
        competitor_price_fmt = format_int_spaces(competitor_price)
        our_best_price_fmt = format_int_spaces(cmp.get("our_best_price_rub"))
        price_diff_fmt = format_int_spaces(cmp.get("price_diff_rub"))
        price_diff_pct = cmp.get("price_diff_pct")

        out.append(
            {
                "position_global": r.get("position_global") or "",
                "page_num": r.get("page_num") or "",
                "page_pos": r.get("page_pos") or "",
                "competitor_listing_id": r.get("competitor_listing_id") or "",
                "deal_type": r.get("deal_type") or "",
                "district": r.get("district") or "",
                "address": r.get("address") or "",
                "area_m2": (
                    f"{float(r['area_m2']):.1f}".rstrip("0").rstrip(".") if isinstance(r.get("area_m2"), (int, float)) else ""
                ),
                "price_rub": competitor_price_fmt,
                "our_best_price_rub": our_best_price_fmt,
                "price_alert": cmp.get("price_alert") or "",
                "price_diff_rub": price_diff_fmt,
                "price_diff_pct": f"{price_diff_pct:.1f}%" if isinstance(price_diff_pct, (int, float)) else "",
                "price_scope": cmp.get("price_scope") or "",
                "pro_mark": r.get("pro_mark") or "",
                "pro_note": r.get("pro_note") or "",
                "competitor_link": hyperlink(r.get("competitor_url"), "ссылка"),
                "our_best_link": cmp.get("our_best_link") or "",
                "result": cmp.get("result") or "",
                "reason": cmp.get("reason") or "",
                "matched_count": cmp.get("matched_count") or 0,
            }
        )
    return out


def save_csv(path: Path, rows):
    fields = [
        "position_global",
        "page_num",
        "page_pos",
        "competitor_listing_id",
        "deal_type",
        "district",
        "address",
        "area_m2",
        "price_rub",
        "our_best_price_rub",
        "price_alert",
        "price_diff_rub",
        "price_diff_pct",
        "price_scope",
        "pro_mark",
        "pro_note",
        "competitor_link",
        "our_best_link",
        "result",
        "matched_count",
        "reason",
    ]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def parse_bool_flag(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    s = str(value).strip().lower()
    if s in {"1", "true", "yes", "y", "on"}:
        return True
    if s in {"0", "false", "no", "n", "off"}:
        return False
    return default


def parse_args():
    parser = argparse.ArgumentParser(description="Сравнение конкурента с deals.xml")
    parser.add_argument(
        "--competitor",
        choices=sorted(COMPETITORS.keys()),
        default="knru",
        help="Какого конкурента парсить.",
    )
    parser.add_argument(
        "--headless",
        default=None,
        help="Режим браузера: true/false (по умолчанию значение HEADLESS из кода).",
    )
    parser.add_argument(
        "--start-url",
        default=None,
        help="Переопределить стартовый URL для выбранного конкурента.",
    )
    parser.add_argument(
        "--yandex-html",
        default=None,
        help="Путь к локальному HTML с window.INITIAL_STATE (fallback для yandex_map).",
    )
    parser.add_argument(
        "--yandex-cookie",
        default=None,
        help="Cookie-строка браузера для realty.yandex.ru (снижает риск капчи).",
    )
    parser.add_argument(
        "--yandex-max-depth",
        type=int,
        default=2,
        help="Глубина тайлового обхода карты Яндекс (0 = только root).",
    )
    parser.add_argument(
        "--yandex-max-tiles",
        type=int,
        default=120,
        help="Максимум тайловых запросов к Яндекс-карте.",
    )
    parser.add_argument(
        "--yandex-delay-ms",
        type=int,
        default=900,
        help="Пауза между тайловыми запросами к Яндекс, мс.",
    )
    parser.add_argument(
        "--rest2rent-html",
        default=None,
        help="Путь к локальному HTML rest2rent (fallback).",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    competitor = args.competitor
    conf = COMPETITORS[competitor]
    start_url = args.start_url or conf["start_url"]
    base_url = conf["base"]
    headless = parse_bool_flag(args.headless, HEADLESS)

    here = Path(__file__).resolve().parent
    my_xml_path = here / MY_XML_FILENAME

    if not my_xml_path.exists():
        print(f"Не найден {MY_XML_FILENAME} в папке: {here}")
        print("Положи deals.xml рядом с robot.py (в папку Parser).")
        return

    print("Читаю ваш XML:", my_xml_path)
    my_items = parse_my_xml(my_xml_path)
    print(f"В вашем XML объектов: {len(my_items)} (rent+sale)")
    print(f"Конкурент: {competitor}")

    today = str(date.today())
    out_csv = here / (f"compare_report_{today}.csv" if competitor == "knru" else f"compare_report_{competitor}_{today}.csv")

    print("Парсю конкурента (все страницы)...")
    if competitor == "yandex_map":
        comp_rows = parse_all_yandex_map(
            start_url=start_url,
            base_url=base_url,
            yandex_html=args.yandex_html,
            yandex_cookie=args.yandex_cookie,
            max_depth=max(0, int(args.yandex_max_depth)),
            max_tiles=max(1, int(args.yandex_max_tiles)),
            delay_ms=max(0, int(args.yandex_delay_ms)),
        )
        print(f"У конкурента карточек: {len(comp_rows)}")
    elif competitor == "rest2rent":
        comp_rows = parse_all_rest2rent_pages(start_url=start_url, base_url=base_url, rest2rent_html=args.rest2rent_html)
        print(f"У конкурента карточек: {len(comp_rows)}")
    else:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=headless)
            page = browser.new_page()
            if competitor == "knru":
                page.goto(start_url, wait_until="domcontentloaded", timeout=120_000)
                comp_rows = parse_all_knru_pages(page, start_url=start_url, base_url=base_url)
            else:
                comp_rows = parse_all_nordwest_pages(page, start_url=start_url, base_url=base_url)
            print(f"У конкурента карточек: {len(comp_rows)}")
            browser.close()

    print("Сравниваю...")
    report = build_report(comp_rows, my_items)

    save_csv(out_csv, report)

    # Короткая сводка в консоль
    stats = {}
    pricey = 0
    pro_yes = 0
    for r in report:
        res = r.get("result") or ""
        stats[res] = stats.get(res, 0) + 1
        if (r.get("price_alert") or "").startswith("У нас дороже"):
            pricey += 1
        if (r.get("pro_mark") or "") == "yes":
            pro_yes += 1

    print("\nГОТОВО:")
    print("-", out_csv)
    print("\nСводка result:")
    for k, v in sorted(stats.items(), key=lambda x: x[1], reverse=True):
        print(f"- {k}: {v}")
    print(f"- У нас дороже: {pricey}")
    print(f"- PRO watermark (эвристика): {pro_yes}")
    print("\nОткрой CSV в Google Sheets — ссылки будут кликабельные.")


if __name__ == "__main__":
    main()
