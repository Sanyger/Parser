#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Собирает финальный compare_report.xlsx из compare_report.csv
по правилам пользователя:
- статистика по всем объектам
- без графиков
- главный лист: сначала совпадения
- "Нет у нас" сортируется по районам: Центральный -> Адмиралтейский -> Петроградский -> остальные
- если у нас дешевле/дороже (при совпадении адрес+площадь ±3), выводим это явно
- Н ПРО не отдельной колонкой: пишем в примечании "Есть лого Н ПРО"
"""

from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

import pandas as pd


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT_CSV = BASE_DIR / f"compare_report_{date.today()}.csv"
DEFAULT_OUT_XLSX = BASE_DIR / f"compare_report_{date.today()}.xlsx"
DEALS_XML = BASE_DIR / "deals.xml"

AREA_TOL_M2 = 3.0


def parse_num(value):
    if value is None:
        return None
    s = str(value).strip()
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


def parse_area_from_reason(reason: str):
    if not reason:
        return None
    m = re.search(r"(\d+(?:[\.,]\d+)?)\s*м²", str(reason), flags=re.I)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", "."))
    except Exception:
        return None


def normalize_deal_type(v: str) -> str:
    s = str(v or "").strip().lower()
    if not s:
        return ""
    if s in {"sale", "business_sale"}:
        return "sale"
    if s in {"rent", "lease"}:
        return "rent"
    if s in {"no_deal"}:
        return "no_deal"
    return s


def extract_url_from_hyperlink(cell):
    if cell is None:
        return ""
    s = str(cell).strip()
    if not s:
        return ""
    m = re.search(r'HYPERLINK\("([^"]+)"', s, flags=re.I)
    if m:
        return m.group(1)
    if s.startswith("http://") or s.startswith("https://"):
        return s
    return ""


def load_item_map(xml_path: Path) -> dict[str, dict]:
    if not xml_path.exists():
        return {}
    out: dict[str, dict] = {}
    root = ET.parse(str(xml_path)).getroot()
    for it in root.findall(".//item"):
        crm_url = (it.findtext("crm_url") or "").strip()
        status = (it.findtext("status") or "").strip()
        deal_type = (it.findtext("deal_type") or "").strip().lower()
        if crm_url:
            out[crm_url] = {"status": status, "deal_type": deal_type}
    return out


def status_note(status_raw: str) -> str:
    s = (status_raw or "").strip().lower()
    if not s:
        return ""
    if "архив" in s:
        return "объект в архиве"
    if "на сайте" in s:
        return "объект на сайте"
    return f"статус: {status_raw.strip()}"


def fmt_money(v):
    n = parse_num(v)
    if n is None:
        return ""
    return f"{int(round(n)):,}".replace(",", " ")


def district_rank(district: str) -> int:
    if district is None:
        d = ""
    else:
        d = str(district).strip().lower()
    if "централь" in d:
        return 0
    if "адмирал" in d:
        return 1
    if "петроград" in d:
        return 2
    return 9


def result_priority(res: str) -> int:
    order = {
        "У нас дешевле": 0,
        "У нас дороже": 1,
        "Цена равна": 2,
        "Совпало (±3 м2)": 3,
        "Совпало": 3,
        "У нас аренда, у конкурента продажа": 4,
        "По адресу есть, но площадь другая": 5,
        "Корпус/строение не совпало": 6,
        "Нет у нас": 7,
    }
    return order.get(res, 8)


def result_with_status(result_code: str, status_raw: str, deal_mismatch: bool) -> str:
    note = status_note(status_raw)
    parts = [result_code]
    if note and result_code != "Нет у нас":
        parts.append(note)
    if deal_mismatch and result_code != "Нет у нас":
        parts.append("у нас другая сделка")
    parts = [p for p in parts if p]
    return ", ".join(parts)


def deal_rank(v: str) -> int:
    # Для сортировки внутри блока совпадений: сначала matching deal.
    if str(v or "").strip().lower() == "same":
        return 0
    if str(v or "").strip().lower() == "diff":
        return 1
    return 2  # unknown


def base_result_for_sort(v: str) -> str:
    s = str(v or "")
    # Берем код до первой запятой (дальше уже статус/другая сделка).
    return s.split(",")[0].strip()


def stats_base_result(v: str) -> str:
    return base_result_for_sort(v)


def build_final_result(base_result: str, area_match: bool, comp_price, our_price) -> str:
    if base_result == "Нет у нас":
        return "Нет у нас"

    if area_match and comp_price is not None and our_price is not None and comp_price > 0:
        if our_price < comp_price:
            return "У нас дешевле"
        if our_price > comp_price:
            return "У нас дороже"
        return "Цена равна"
    if area_match:
        return "Совпало (±3 м2)"

    # Базовое "Совпало" в исходном CSV считалось по старому порогу;
    # при текущем пороге ±3 относим в "площадь другая".
    if base_result in {"Совпало", "Совпало (±3 м2)", "У нас аренда, у конкурента продажа"}:
        return "По адресу есть, но площадь другая"

    return base_result or ""


def parse_args():
    parser = argparse.ArgumentParser(description="Сборка финального xlsx из compare_report csv")
    parser.add_argument("--input", dest="input_csv", default=str(DEFAULT_INPUT_CSV), help="Путь к входному CSV")
    parser.add_argument("--output", dest="output_xlsx", default=str(DEFAULT_OUT_XLSX), help="Путь к выходному XLSX")
    return parser.parse_args()


def main():
    args = parse_args()
    input_csv = Path(args.input_csv)
    out_xlsx = Path(args.output_xlsx)

    if not input_csv.exists():
        raise FileNotFoundError(f"Не найден входной файл: {input_csv}")

    df = pd.read_csv(input_csv)
    item_map = load_item_map(DEALS_XML)

    df["position_global_num"] = pd.to_numeric(df["position_global"], errors="coerce")
    df["comp_area_num"] = df["area_m2"].map(parse_num)
    df["our_area_num"] = df["reason"].map(parse_area_from_reason)
    df["comp_price_num"] = df["price_rub"].map(parse_num)
    df["our_price_num"] = df["our_best_price_rub"].map(parse_num)

    df["area_diff_num"] = (df["comp_area_num"] - df["our_area_num"]).abs()
    df["area_match_3m2"] = (
        df["result"].fillna("") != "Нет у нас"
    ) & df["comp_area_num"].notna() & df["our_area_num"].notna() & (df["area_diff_num"] <= AREA_TOL_M2)

    df["final_result"] = df.apply(
        lambda r: build_final_result(
            str(r.get("result") or ""),
            bool(r.get("area_match_3m2")),
            r.get("comp_price_num"),
            r.get("our_price_num"),
        ),
        axis=1,
    )
    df["our_url"] = df["our_best_link"].map(extract_url_from_hyperlink)
    df["our_status"] = df["our_url"].map(lambda u: item_map.get(u, {}).get("status", "") if u else "")
    df["our_deal_type"] = df["our_url"].map(lambda u: item_map.get(u, {}).get("deal_type", "") if u else "")
    if "deal_type" in df.columns:
        df["comp_deal_type"] = df["deal_type"].fillna("").map(normalize_deal_type)
    else:
        df["comp_deal_type"] = "sale"
    df["our_deal_type_norm"] = df["our_deal_type"].map(normalize_deal_type)
    df["comp_deal_type_norm"] = df["comp_deal_type"].map(normalize_deal_type)
    df["deal_match_code"] = df.apply(
        lambda r: (
            "same"
            if r.get("our_deal_type_norm") and r.get("comp_deal_type_norm") and r.get("our_deal_type_norm") == r.get("comp_deal_type_norm")
            else ("diff" if r.get("our_deal_type_norm") and r.get("comp_deal_type_norm") else "unknown")
        ),
        axis=1,
    )
    df["final_result_text"] = df.apply(
        lambda r: result_with_status(
            str(r.get("final_result") or ""),
            str(r.get("our_status") or ""),
            bool(r.get("deal_match_code") == "diff"),
        ),
        axis=1,
    )

    # Примечание: если есть Н ПРО, пишем в этой колонке.
    df["note"] = ""
    df.loc[df["pro_mark"].fillna("").str.lower() == "yes", "note"] = "Есть лого Н ПРО"

    # Сортировка:
    # 1) по выводу (совпадения сверху)
    # 2) для "Нет у нас" — приоритет районов
    # 3) затем номер конкурента
    df["result_prio"] = df["final_result"].map(result_priority)
    df["district_prio"] = df["district"].map(district_rank)
    df["deal_prio"] = df["deal_match_code"].map(deal_rank)
    df["not_ours_flag"] = (df["final_result"] == "Нет у нас").astype(int)

    is_not_ours = df["final_result"] == "Нет у нас"
    df.loc[~is_not_ours, "district_prio"] = 0

    df = df.sort_values(
        by=["not_ours_flag", "result_prio", "deal_prio", "district_prio", "district", "position_global_num"],
        ascending=[True, True, True, True, True, True],
    )

    # Главный лист с минимумом полей.
    main_sheet = pd.DataFrame(
        {
            "№ конкурента": df["position_global_num"].map(lambda x: "" if pd.isna(x) else int(x)),
            "Район": df["district"].fillna(""),
            "Адрес": df["address"].fillna(""),
            "Площадь конкурента, м2": df["comp_area_num"].map(lambda x: "" if pd.isna(x) else round(float(x), 1)),
            "Площадь у нас, м2": df["our_area_num"].map(lambda x: "" if pd.isna(x) else round(float(x), 1)),
            "Δ площадь, м2": df["area_diff_num"].map(lambda x: "" if pd.isna(x) else round(float(x), 1)),
            "Цена конкурента": df["comp_price_num"].map(fmt_money),
            "Цена у нас": df["our_price_num"].map(fmt_money),
            "Вывод": df["final_result_text"].fillna(""),
            "Примечание": df["note"].fillna(""),
            "Ссылка конкурента": df["competitor_link"].fillna(""),
            "Ссылка у нас": df["our_best_link"].fillna(""),
        }
    )

    # Статистика по всем объектам.
    total = len(df)
    match_3 = int(df["area_match_3m2"].sum())
    # В ценовые метрики включаем только совпадающий тип сделки + match по площади ±3.
    strict_price_cmp = df["area_match_3m2"] & (df["deal_match_code"] == "same")
    comp_cheaper = int(((df["final_result"] == "У нас дороже") & strict_price_cmp).sum())  # у конкурента дешевле
    npro = int((df["pro_mark"].fillna("").str.lower() == "yes").sum())
    ours_cheaper = int(((df["final_result"] == "У нас дешевле") & strict_price_cmp).sum())
    not_ours = int((df["final_result"] == "Нет у нас").sum())
    diff_deal = int(((df["deal_match_code"] == "diff") & (df["final_result"] != "Нет у нас")).sum())

    stats = pd.DataFrame(
        [
            {"Показатель": "Всего объектов конкурента", "Значение": total},
            {"Показатель": "Совпали адрес+площадь (±3 м2)", "Значение": match_3},
            {"Показатель": "У конкурента дешевле (при совпадении ±3)", "Значение": comp_cheaper},
            {"Показатель": "У нас дешевле (при совпадении ±3)", "Значение": ours_cheaper},
            {"Показатель": "У нас другая сделка", "Значение": diff_deal},
            {"Показатель": "Спарсили с Н ПРО", "Значение": npro},
            {"Показатель": "Нет у нас", "Значение": not_ours},
        ]
    )

    with pd.ExcelWriter(out_xlsx, engine="openpyxl") as w:
        main_sheet.to_excel(w, sheet_name="Главный", index=False)
        stats.to_excel(w, sheet_name="Статистика", index=False)

    print(f"Saved: {out_xlsx}")
    print(stats.to_string(index=False))


if __name__ == "__main__":
    main()
