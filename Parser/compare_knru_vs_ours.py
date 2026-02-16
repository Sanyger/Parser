import re
from difflib import SequenceMatcher
from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
OURS_XLSX = BASE_DIR / "deals_changes.xlsx"
OUT_XLSX = BASE_DIR / "compare_knru_vs_ours.xlsx"

STOP_WORDS = {
    "ул",
    "улица",
    "пр",
    "пр-кт",
    "просп",
    "проспект",
    "наб",
    "набережная",
    "пер",
    "переулок",
    "пл",
    "площадь",
    "ш",
    "шоссе",
    "д",
    "дом",
    "к",
    "корпус",
    "стр",
    "строение",
    "лит",
    "литер",
}


def norm_text(s: str) -> str:
    s = (s or "").strip().lower().replace("ё", "е")
    s = re.sub(r"[,\.;:()\"'`]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def extract_house(raw: str) -> str:
    s = norm_text(raw)
    m = re.search(
        r"\b(?:д(?:ом)?\.?\s*)?(\d+[а-яa-z]?(?:/\d+[а-яa-z]?)?)"
        r"(?:\s*(?:к|корпус)\.?\s*(\d+[а-яa-z]?))?"
        r"(?:\s*(?:стр|строение)\.?\s*(\d+[а-яa-z]?))?"
        r"(?:\s*(?:лит|литер)\.?\s*([а-яa-z]))?",
        s,
        flags=re.I,
    )
    if not m:
        return ""
    out = m.group(1)
    if m.group(2):
        out += f" к{m.group(2)}"
    if m.group(3):
        out += f" стр{m.group(3)}"
    if m.group(4):
        out += f" лит {m.group(4)}"
    return out.strip()


def make_name_key(text: str) -> str:
    s = norm_text(text)
    parts = [p for p in s.split() if p not in STOP_WORDS]
    return " ".join(parts).strip()


def extract_street_hint(raw_address: str) -> str:
    s = norm_text(raw_address)
    s = re.sub(r"\b(?:д|дом)\.?\s*\d+[а-яa-z]?(?:/\d+[а-яa-z]?)?\b", " ", s)
    s = re.sub(r"\b\d+[а-яa-z]?(?:/\d+[а-яa-z]?)?\b", " ", s)
    s = re.sub(r"\b(?:к|корпус|стр|строение|лит|литер)\.?\s*[а-яa-z0-9]+\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if "," in s:
        s = s.split(",")[-1].strip() or s
    return s


def latest_knru_file() -> Path:
    files = sorted(BASE_DIR.glob("knru_test_*.csv"))
    if not files:
        raise FileNotFoundError("Не найден knru_test_*.csv в папке Parser. Сначала запусти knru_test_parser.py")
    return files[-1]


def best_street_match(street_key: str, pool: list[str]):
    if not street_key:
        return "", 0
    best_key = ""
    best_score = 0
    for candidate in pool:
        if not candidate:
            continue
        if abs(len(street_key) - len(candidate)) > 10:
            continue
        score = int(SequenceMatcher(None, street_key, candidate).ratio() * 100)
        if score > best_score:
            best_score = score
            best_key = candidate
    return best_key, best_score


def main():
    comp_csv = latest_knru_file()

    ours = pd.read_excel(OURS_XLSX, sheet_name="batch")
    comp = pd.read_csv(comp_csv)

    ours["our_street_key"] = ours["street_key"].fillna("").map(make_name_key)
    ours["our_house_key"] = ours["house_part"].fillna("").map(norm_text)
    ours["our_cmp_key"] = ours["our_street_key"] + "::" + ours["our_house_key"]

    ours_valid = ours[ours["our_street_key"] != ""].copy()
    ours_valid = ours_valid.drop_duplicates(subset=["our_cmp_key", "crm_url"], keep="first")

    comp["comp_address"] = comp["address"].fillna("")
    comp["comp_house_key"] = comp["comp_address"].map(extract_house).map(norm_text)
    comp["comp_street_hint"] = comp["comp_address"].map(extract_street_hint)
    comp["comp_street_key"] = comp["comp_street_hint"].map(make_name_key)
    comp["comp_cmp_key"] = comp["comp_street_key"] + "::" + comp["comp_house_key"]

    our_exact_keys = set(ours_valid["our_cmp_key"].tolist())
    our_street_pool = sorted(set(ours_valid["our_street_key"].tolist()))

    match_rows = []
    competitor_only_rows = []

    for _, row in comp.iterrows():
        c_key = row["comp_cmp_key"]
        c_street = row["comp_street_key"]

        if c_key in our_exact_keys and c_key.strip(":"):
            matched = ours_valid[ours_valid["our_cmp_key"] == c_key].head(1).iloc[0]
            out = dict(row)
            out.update(
                {
                    "match_type": "exact",
                    "match_score": 100,
                    "our_address_canonical": matched.get("address_canonical", ""),
                    "our_crm_url": matched.get("crm_url", ""),
                    "our_norm_status": matched.get("norm_status", ""),
                }
            )
            match_rows.append(out)
            continue

        best_street, score = best_street_match(c_street, our_street_pool)
        if best_street and score >= 90 and row["comp_house_key"]:
            subset = ours_valid[
                (ours_valid["our_street_key"] == best_street)
                & (ours_valid["our_house_key"] == row["comp_house_key"])
            ]
            if not subset.empty:
                matched = subset.head(1).iloc[0]
                out = dict(row)
                out.update(
                    {
                        "match_type": "fuzzy_street+house",
                        "match_score": score,
                        "our_address_canonical": matched.get("address_canonical", ""),
                        "our_crm_url": matched.get("crm_url", ""),
                        "our_norm_status": matched.get("norm_status", ""),
                    }
                )
                match_rows.append(out)
                continue

        out = dict(row)
        out.update(
            {
                "match_type": "not_found",
                "match_score": score,
                "best_our_street_key": best_street,
            }
        )
        competitor_only_rows.append(out)

    matched_df = pd.DataFrame(match_rows)
    competitor_only_df = pd.DataFrame(competitor_only_rows)

    matched_keys = set(matched_df.get("our_crm_url", pd.Series(dtype=str)).dropna().tolist())
    ours_only_df = ours_valid[~ours_valid["crm_url"].isin(matched_keys)].copy()

    summary = pd.DataFrame(
        [
            {"bucket": "competitor_total", "count": len(comp)},
            {"bucket": "matched", "count": len(matched_df)},
            {"bucket": "competitor_only", "count": len(competitor_only_df)},
            {"bucket": "ours_only", "count": len(ours_only_df)},
        ]
    )

    with pd.ExcelWriter(OUT_XLSX, engine="openpyxl") as w:
        summary.to_excel(w, sheet_name="summary", index=False)
        comp.to_excel(w, sheet_name="competitor_all", index=False)
        matched_df.to_excel(w, sheet_name="matched", index=False)
        competitor_only_df.to_excel(w, sheet_name="competitor_only", index=False)
        ours_only_df.to_excel(w, sheet_name="ours_only", index=False)

    print(f"Competitor CSV: {comp_csv}")
    print(f"Saved: {OUT_XLSX}")
    print(summary.to_string(index=False))


if __name__ == "__main__":
    main()
