#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from difflib import get_close_matches
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point, box
from shapely.strtree import STRtree


BASE_DIR = Path(__file__).resolve().parent
STREET_DIR = BASE_DIR.parent / "street"

INPUT_XML = BASE_DIR / "deals.xml"
OUTPUT_XML = BASE_DIR / "deals_canonical.xml"
OUTPUT_XLSX = BASE_DIR / "deals_canonical.xlsx"

ROADS_SHP = STREET_DIR / "gis_osm_roads_free_1.shp"
PLACES_SHP = STREET_DIR / "gis_osm_places_free_1.shp"

ROADS_FCLASS_WHITELIST = {
    "residential",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "living_street",
    "trunk",
    "motorway",
    "primary_link",
    "secondary_link",
    "tertiary_link",
    "trunk_link",
    "motorway_link",
}
PLACES_FCLASS_WHITELIST = {"city", "town", "village", "suburb"}

ROAD_MAX_DIST_M = 500.0
PLACE_MAX_DIST_M = 30000.0
FUZZY_TYPO_THRESHOLD = 88
MISMATCH_THRESHOLD = 65

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
    "аллея",
    "линия",
    "д",
    "дом",
    "корпус",
    "к",
    "строение",
    "стр",
    "лит",
    "литер",
}


@dataclass
class Nearby:
    osm_id: Optional[int]
    name: str
    fclass: str
    distance_m: Optional[float]


def norm_text(s: str) -> str:
    s = (s or "").lower().replace("ё", "е")
    s = re.sub(r"[,\.;:()\"'`]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def make_name_key(text: str) -> str:
    s = norm_text(text)
    parts = [p for p in s.split() if p not in STOP_WORDS]
    return " ".join(parts).strip()


def extract_house(text: str) -> str:
    s = norm_text(text)
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
    base = m.group(1)
    corp = m.group(2)
    st = m.group(3)
    lit = m.group(4)
    result = base
    if corp:
        result += f" к{corp}"
    if st:
        result += f" стр{st}"
    if lit:
        result += f" лит {lit}"
    return result.strip()


def parse_coords(coords_text: str) -> Optional[tuple[float, float]]:
    if not coords_text:
        return None
    raw = coords_text.strip()
    if not raw:
        return None
    parts = [p.strip() for p in raw.split(",")]
    if len(parts) != 2:
        return None
    try:
        a = float(parts[0])
        b = float(parts[1])
    except ValueError:
        return None
    if abs(a) < 1e-9 and abs(b) < 1e-9:
        return None
    if 27 <= a <= 35 and 55 <= b <= 61:
        lon, lat = a, b
    elif 55 <= a <= 61 and 27 <= b <= 35:
        lat, lon = a, b
    else:
        lon, lat = a, b
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    return lon, lat


def bbox_from_coords(coords: list[tuple[float, float]]):
    if not coords:
        return None
    lons = [c[0] for c in coords]
    lats = [c[1] for c in coords]
    pad = 0.25
    return box(min(lons) - pad, min(lats) - pad, max(lons) + pad, max(lats) + pad)


def load_layers(bbox_geom):
    roads = gpd.read_file(ROADS_SHP, bbox=bbox_geom)[["osm_id", "fclass", "name", "geometry"]]
    roads = roads[
        roads["fclass"].isin(ROADS_FCLASS_WHITELIST)
        & roads["name"].notna()
        & (roads["name"].astype(str).str.strip() != "")
    ].copy()

    places = gpd.read_file(PLACES_SHP, bbox=bbox_geom)[["osm_id", "fclass", "name", "geometry"]]
    places = places[
        places["fclass"].isin(PLACES_FCLASS_WHITELIST)
        & places["name"].notna()
        & (places["name"].astype(str).str.strip() != "")
    ].copy()
    return roads, places


def build_street_catalog(roads: gpd.GeoDataFrame, places: gpd.GeoDataFrame):
    roads = roads.copy()
    roads["name_key"] = roads["name"].map(make_name_key)
    roads = roads[roads["name_key"] != ""].copy()
    grp = roads.groupby("name_key", as_index=False).agg(
        street_name=("name", lambda x: x.mode().iloc[0] if not x.mode().empty else x.iloc[0]),
        street_fclass=("fclass", "first"),
        sample_osm_id=("osm_id", "first"),
    )
    place_keys = set(places["name"].astype(str).map(make_name_key).tolist())
    grp = grp[~grp["name_key"].isin(place_keys)].copy()
    return grp


def build_fuzzy_index(catalog: pd.DataFrame):
    exact = {}
    by_first = {}
    for _, row in catalog.iterrows():
        key = str(row["name_key"])
        exact[key] = row
        first = key[:1]
        by_first.setdefault(first, []).append(row)
    return exact, by_first


def best_fuzzy(street_key: str, catalog: pd.DataFrame, exact_idx: dict, by_first_idx: dict):
    if not street_key:
        return None, 0
    if street_key in exact_idx:
        return exact_idx[street_key], 100

    candidates = by_first_idx.get(street_key[:1], [])
    if not candidates:
        candidates = list(catalog.to_dict("records"))
    if len(candidates) > 1500:
        shortlist_keys = get_close_matches(
            street_key,
            [str(r["name_key"]) for r in candidates],
            n=12,
            cutoff=0.55,
        )
        allowed = set(shortlist_keys)
        if allowed:
            candidates = [r for r in candidates if str(r["name_key"]) in allowed]

    best_row = None
    best_score = 0
    for row in candidates:
        key = str(row["name_key"])
        if abs(len(street_key) - len(key)) > 10:
            continue
        score = int(SequenceMatcher(None, street_key, key).ratio() * 100)
        if score > best_score:
            best_score = score
            best_row = row
    return best_row, best_score


def extract_raw_street_hint(raw_address: str) -> str:
    s = norm_text(raw_address)
    if not s:
        return ""
    s = re.sub(r"\b(?:д|дом)\.?\s*\d+[а-яa-z]?(?:/\d+[а-яa-z]?)?\b", " ", s)
    s = re.sub(r"\b\d+[а-яa-z]?(?:/\d+[а-яa-z]?)?\b", " ", s)
    s = re.sub(r"\b(?:к|корпус|стр|строение|лит|литер)\.?\s*[а-яa-z0-9]+\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if "," in s:
        s = s.split(",")[-1].strip() or s
    return s


def set_text(item: ET.Element, tag: str, text: str):
    el = item.find(tag)
    if el is None:
        el = ET.SubElement(item, tag)
    el.text = text


def nearest_from_tree(
    lon: float,
    lat: float,
    gdf_wgs84: gpd.GeoDataFrame,
    gdf_metric: gpd.GeoDataFrame,
    tree: STRtree,
    idx_by_geom_wkb: dict[bytes, int],
    max_distance_m: float,
) -> Nearby:
    point_wgs84 = Point(lon, lat)
    point_metric = gpd.GeoSeries([point_wgs84], crs=4326).to_crs(gdf_metric.crs).iloc[0]
    nearest_obj = tree.nearest(point_metric)
    if nearest_obj is None:
        return Nearby(None, "", "", None)
    if isinstance(nearest_obj, (int,)):
        idx = int(nearest_obj)
    elif hasattr(nearest_obj, "item"):
        idx = int(nearest_obj.item())
    else:
        idx = idx_by_geom_wkb.get(nearest_obj.wkb)
        if idx is None:
            return Nearby(None, "", "", None)
    dist = float(point_metric.distance(gdf_metric.geometry.iloc[idx]))
    if dist > max_distance_m:
        return Nearby(None, "", "", dist)
    row = gdf_wgs84.iloc[idx]
    return Nearby(
        osm_id=int(row["osm_id"]) if pd.notna(row["osm_id"]) else None,
        name=str(row["name"]),
        fclass=str(row["fclass"]),
        distance_m=dist,
    )


def canonical_address(place: str, street: str, house: str):
    parts = []
    if place:
        parts.append(place)
    if street:
        parts.append(street)
    if house:
        parts.append(f"д. {house}")
    return ", ".join(parts)


def main():
    root = ET.parse(INPUT_XML).getroot()
    items = root.findall(".//item")
    coords = []
    for item in items:
        parsed = parse_coords(item.findtext("coords") or "")
        if parsed:
            coords.append(parsed)
    bbox_geom = bbox_from_coords(coords)
    roads, places = load_layers(bbox_geom)
    if roads.empty or places.empty:
        raise RuntimeError("Пустые roads/places после фильтрации. Проверь входные shapefile.")

    metric_crs = roads.estimate_utm_crs()
    roads_m = roads.to_crs(metric_crs)
    places_m = places.to_crs(metric_crs)

    road_geoms = list(roads_m.geometry.values)
    place_geoms = list(places_m.geometry.values)
    road_tree = STRtree(road_geoms)
    place_tree = STRtree(place_geoms)
    road_idx = {g.wkb: i for i, g in enumerate(road_geoms)}
    place_idx = {g.wkb: i for i, g in enumerate(place_geoms)}

    catalog = build_street_catalog(roads, places)
    exact_idx, by_first_idx = build_fuzzy_index(catalog)
    out_rows = []

    for i, item in enumerate(items, start=1):
        raw_address = (item.findtext("address") or "").strip()
        coords_text = (item.findtext("coords") or "").strip()
        crm_url = (item.findtext("crm_url") or "").strip()
        house_part = extract_house(raw_address)
        parsed = parse_coords(coords_text)

        matched_place = ""
        matched_street = ""
        place_dist = None
        street_dist = None
        status = ""
        final_addr = ""

        street_hint = extract_raw_street_hint(raw_address)
        hint_key = make_name_key(street_hint)

        if parsed:
            lon, lat = parsed
            place = nearest_from_tree(
                lon, lat, places, places_m, place_tree, place_idx, PLACE_MAX_DIST_M
            )
            road = nearest_from_tree(
                lon, lat, roads, roads_m, road_tree, road_idx, ROAD_MAX_DIST_M
            )
            matched_place = place.name
            place_dist = place.distance_m
            matched_street = road.name
            street_dist = road.distance_m

            if matched_street:
                final_addr = canonical_address(matched_place, matched_street, house_part)
                if hint_key:
                    score = int(SequenceMatcher(None, hint_key, make_name_key(matched_street)).ratio() * 100)
                    status = "coords_mismatch" if score < MISMATCH_THRESHOLD else "ok"
                else:
                    status = "ok"
                if not house_part:
                    status = f"{status};house_missing"
            else:
                best, score = best_fuzzy(hint_key, catalog, exact_idx, by_first_idx)
                if best is not None and score >= FUZZY_TYPO_THRESHOLD:
                    matched_street = str(best["street_name"])
                    final_addr = canonical_address(matched_place, matched_street, house_part)
                    status = "typo_suspected"
                else:
                    final_addr = canonical_address(matched_place, "", house_part)
                    status = "candidate_new"
        else:
            best, score = best_fuzzy(hint_key, catalog, exact_idx, by_first_idx)
            if best is not None and score >= FUZZY_TYPO_THRESHOLD:
                matched_street = str(best["street_name"])
                final_addr = canonical_address("", matched_street, house_part)
                status = "no_coords_typo_suspected"
            else:
                final_addr = canonical_address("", street_hint, house_part)
                status = "no_coords_candidate_new" if raw_address else "no_coords_no_address"

        set_text(item, "address_canonical", final_addr)
        set_text(item, "house_part", house_part)
        set_text(item, "matched_place", matched_place)
        set_text(item, "matched_street", matched_street)
        set_text(item, "distance_place_m", "" if place_dist is None else f"{place_dist:.1f}")
        set_text(item, "distance_street_m", "" if street_dist is None else f"{street_dist:.1f}")
        set_text(item, "norm_status", status)

        out_rows.append(
            {
                "idx": i,
                "crm_url": crm_url,
                "raw_address": raw_address,
                "coords": coords_text,
                "address_canonical": final_addr,
                "house_part": house_part,
                "matched_place": matched_place,
                "matched_street": matched_street,
                "distance_place_m": place_dist,
                "distance_street_m": street_dist,
                "norm_status": status,
                "street_hint": street_hint,
                "street_hint_key": hint_key,
            }
        )

    ET.ElementTree(root).write(OUTPUT_XML, encoding="utf-8", xml_declaration=True)
    pd.DataFrame(out_rows).to_excel(OUTPUT_XLSX, index=False)

    summary = pd.DataFrame(out_rows)["norm_status"].value_counts(dropna=False)
    print("Done.")
    print(f"Input items: {len(items)}")
    print(f"Roads used: {len(roads)}")
    print(f"Places used: {len(places)}")
    print("Status summary:")
    print(summary.to_string())
    print(f"Saved XML: {OUTPUT_XML}")
    print(f"Saved XLSX: {OUTPUT_XLSX}")


if __name__ == "__main__":
    main()
