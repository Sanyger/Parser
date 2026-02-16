from playwright.sync_api import sync_playwright
import re
import json
import csv
from datetime import date
from pathlib import Path

START_URL = "https://knru.ru/commercial/"
BASE = "https://knru.ru"
HEADLESS = False
OUT_DIR = Path(__file__).resolve().parent


def clean_text(s):
    if not s:
        return None
    return s.replace("\xa0", " ").strip()


def extract_first_number(text):
    if not text:
        return None
    t = clean_text(text)
    m = re.search(r"(\d[\d\s]*[.,]?\d*)", t)
    if not m:
        return None
    num = m.group(1).replace(" ", "").replace(",", ".")
    try:
        return float(num) if "." in num else int(num)
    except Exception:
        return None


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


def parse_one_page(page):
    page.wait_for_selector("div.product-item-container", timeout=60_000)

    cards = page.locator("div.product-item-container")
    total = cards.count()
    rows = []

    for i in range(total):
        card = cards.nth(i)

        url = None
        a_catalog = card.locator('a[href^="/catalog/"]').first
        if a_catalog.count() > 0:
            href = a_catalog.get_attribute("href")
            if href:
                url = BASE + href

        title = get_title_from_card(card)

        address = None
        if card.locator("div.product-item__adress span").count() > 0:
            address = clean_text(card.locator("div.product-item__adress span").first.inner_text())
        elif card.locator("div.product-item__adress").count() > 0:
            address = clean_text(card.locator("div.product-item__adress").first.inner_text())
        if address:
            address = address.replace("На карте", "").strip()

        district = None
        if card.locator("div.district__title").count() > 0:
            district = clean_text(card.locator("div.district__title").first.inner_text())
        elif card.locator("a.district").count() > 0:
            district = clean_text(card.locator("a.district").first.inner_text())

        price_txt = clean_text(card.locator("div.product-item__price").first.inner_text()) if card.locator("div.product-item__price").count() else None
        price_rub = extract_first_number(price_txt)

        area_txt = clean_text(card.locator("div.square__title").first.inner_text()) if card.locator("div.square__title").count() else None
        area_m2 = extract_first_number(area_txt)

        rows.append(
            {
                "deal_type": "sale",
                "title": title,
                "address": address,
                "district": district,
                "price_rub": price_rub,
                "area_m2": area_m2,
                "url": url,
            }
        )

    return rows


def save_json(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)


def save_csv(path, rows):
    fields = ["deal_type", "title", "address", "district", "price_rub", "area_m2", "url"]
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def main():
    today = str(date.today())
    out_json = OUT_DIR / f"knru_test_{today}.json"
    out_csv = OUT_DIR / f"knru_test_{today}.csv"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=HEADLESS)
        page = browser.new_page()
        page.goto(START_URL, wait_until="domcontentloaded", timeout=120_000)

        rows = parse_one_page(page)

        print(f"Карточек на странице: {len(rows)}")
        for i, r in enumerate(rows[:8], 1):
            print(f"{i}. {r['title']} | {r['address']} | {r['price_rub']} | {r['url']}")

        save_json(out_json, rows)
        save_csv(out_csv, rows)

        print("Готово:")
        print(out_json)
        print(out_csv)

        browser.close()


if __name__ == "__main__":
    main()
