#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
address_autotest.py

Автотесты для robot.py:
1) Регрессии на известных проблемных адресах.
2) Генеративные проверки на сотнях вариантов записи улицы/дома.

Запуск:
python3 /Users/aleksandrarakceev/Desktop/Parser/address_autotest.py
"""

from __future__ import annotations

import importlib.util
import random
import sys
import unittest
from pathlib import Path


ROBOT_PATH = Path(__file__).resolve().parent / "robot.py"


def load_robot_module():
    spec = importlib.util.spec_from_file_location("robot_under_test", ROBOT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Не удалось загрузить {ROBOT_PATH}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["robot_under_test"] = mod
    spec.loader.exec_module(mod)
    return mod


robot = load_robot_module()


def make_item(address: str, area_m2: float = 100.0, deal_type: str = "sale", crm_url: str = "local://1"):
    return {
        "deal_type": deal_type,
        "status": "На сайте",
        "address": address,
        "area_m2": area_m2,
        "price_rub": 1_000_000,
        "crm_url": crm_url,
    }


def compare(comp_address: str, my_address: str, comp_area: float = 100.0, my_area: float = 100.0):
    my_items = [make_item(my_address, area_m2=my_area)]
    idx = robot.build_my_index(my_items)
    out = robot.compare_one(
        {"deal_type": "sale", "address": comp_address, "area_m2": comp_area},
        idx,
    )
    return out.get("result"), out.get("reason")


class AddressRegressionTests(unittest.TestCase):
    def test_user_reported_regressions(self):
        cases = [
            ("Фёдора Абрамова, 18к1", "ул. Фёдора Абрамова, 18"),
            ("Захарьевская ул, 16", "Захарьевская улица, 16 39"),
            ("Жуковского ул, 7-9", "улица Жуковского, 7 пом 5"),
            ("Маршала Казакова ул, 70к1 стр 1", "ул. Маршала Казакова, 70к1с1"),
            ("Маршала Казакова ул, 70к1 стр 1", "ул. Маршала Казакова, 70 корпус 1"),
            ("Гагаринская ул, 6/1", "Гагаринская ул., 6-а"),
            ("2-я Советская, 10", "2-я Советская ул., 10 б"),
        ]
        allowed = {"Совпало", "По адресу есть, но площадь другая", "У нас аренда, у конкурента продажа"}
        for comp_addr, my_addr in cases:
            with self.subTest(comp=comp_addr, my=my_addr):
                result, reason = compare(comp_addr, my_addr)
                self.assertIn(result, allowed, msg=f"{comp_addr} vs {my_addr}: {result} / {reason}")

    def test_range_house_overlap(self):
        result, reason = compare("Жуковского ул, 7-9", "улица Жуковского, 7")
        self.assertEqual(result, "Совпало", msg=reason)

    def test_corp_mismatch_detected(self):
        result, reason = compare("Маршала Казакова ул, 70к1", "ул. Маршала Казакова, 70к2")
        self.assertEqual(result, "Корпус/строение не совпало", msg=reason)

    def test_trailing_room_not_overrides_house(self):
        c = robot.extract_components("Захарьевская ул, 16")
        m = robot.extract_components("Захарьевская улица, 16 39")
        self.assertEqual(c["house_from"], 16)
        self.assertEqual(m["house_from"], 16)

    def test_compact_corp_str_split(self):
        c = robot.extract_components("Маршала Казакова ул, 70к1 стр 1")
        m = robot.extract_components("ул. Маршала Казакова, 70к1с1")
        self.assertEqual(c["house_from"], 70)
        self.assertEqual(m["house_from"], 70)
        self.assertEqual(c["corp"], "1")
        self.assertEqual(m["corp"], "1")
        self.assertEqual(c["str"], "1")
        self.assertEqual(m["str"], "1")

    def test_house_letter_tail_not_becomes_street(self):
        comp = robot.extract_components("2-я Советская, 10")
        ours = robot.extract_components("2-я Советская ул., 10 б")
        self.assertEqual(comp["street_key_bag"], "2-я советская")
        self.assertEqual(ours["street_key_bag"], "2-я советская")
        self.assertEqual(comp["house_from"], 10)
        self.assertEqual(ours["house_from"], 10)


class AddressGenerativeTests(unittest.TestCase):
    RNG_SEED = 20260215
    ITERATIONS = 400

    STREET_NAMES = [
        "Федора Абрамова",
        "Маршала Казакова",
        "Жуковского",
        "Захарьевская",
        "Белы Куна",
        "Коллонтай",
        "25 Октября",
        "Лени Голикова",
        "Будапештская",
        "Кронверкская",
        "Софийская",
        "Типанова",
    ]

    TYPE_VARIANTS = [
        ("ул", "улица"),
        ("пр", "проспект"),
        ("наб", "набережная"),
        ("пер", "переулок"),
        ("ш", "шоссе"),
    ]

    def _house_repr(self, house: int, corp: int | None, stro: int | None, compact: bool):
        if corp and stro:
            if compact:
                return f"{house}к{corp}с{stro}"
            return f"{house} корпус {corp} стр {stro}"
        if corp:
            if compact:
                return f"{house}к{corp}"
            return f"{house} корпус {corp}"
        if stro:
            if compact:
                return f"{house}с{stro}"
            return f"{house} стр {stro}"
        return str(house)

    def _build_pair(self, rng: random.Random):
        street = rng.choice(self.STREET_NAMES)
        t_short, t_long = rng.choice(self.TYPE_VARIANTS)
        house = rng.randint(1, 220)
        corp = rng.choice([None, None, None, rng.randint(1, 4)])
        stro = rng.choice([None, None, None, rng.randint(1, 3)])

        my_house = self._house_repr(house, corp, stro, compact=rng.choice([True, False]))
        comp_house = self._house_repr(house, corp, stro, compact=rng.choice([True, False]))

        my_templates = [
            f"{t_long} {street}, {my_house}",
            f"{t_short}. {street}, {my_house}",
            f"{street} {t_long}, {my_house}",
            f"{street}, {my_house}",
        ]
        comp_templates = [
            f"{street} {t_short}, {comp_house}",
            f"{t_long} {street}, {comp_house}",
            f"{street}, {comp_house}",
            f"{street} {t_long}, {comp_house}",
        ]

        my_addr = rng.choice(my_templates)
        comp_addr = rng.choice(comp_templates)

        if rng.random() < 0.25:
            my_addr = f"{my_addr} пом {rng.randint(1, 90)}"
        if rng.random() < 0.25:
            comp_addr = f"{comp_addr} пом {rng.randint(1, 90)}"

        if rng.random() < 0.10 and "-" not in comp_house and house <= 218:
            comp_addr = comp_addr.replace(str(house), f"{house}-{house + 2}", 1)
            # Для диапазона дом в нашей базе остаётся одним номером.

        return comp_addr, my_addr

    def test_generated_variants_match(self):
        rng = random.Random(self.RNG_SEED)
        failures = []
        allowed = {"Совпало", "По адресу есть, но площадь другая", "У нас аренда, у конкурента продажа"}

        for i in range(self.ITERATIONS):
            comp_addr, my_addr = self._build_pair(rng)
            result, reason = compare(comp_addr, my_addr)
            if result not in allowed:
                failures.append((i, comp_addr, my_addr, result, reason))

        if failures:
            sample = failures[:15]
            lines = [
                f"#{i}: COMP='{c}' | MY='{m}' => {r} ({why})"
                for i, c, m, r, why in sample
            ]
            self.fail(
                "Найдены несовпадения в генеративном тесте:\n" + "\n".join(lines)
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
