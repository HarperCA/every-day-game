import json
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.validate_seed import validate  # noqa: E402


class SeedDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = json.loads((ROOT / "data" / "seed" / "competitions.json").read_text(encoding="utf-8"))

    def test_seed_has_30_competitions_and_14_professions(self):
        self.assertEqual(len(self.data["event_masters"]), 30)
        self.assertEqual(len(self.data["event_editions"]), 30)
        self.assertEqual(len(self.data["profession_categories"]), 14)

    def test_seed_passes_structural_validation(self):
        self.assertEqual(validate(self.data), [])

    def test_2025_edition_id_is_corrected(self):
        challenge = next(item for item in self.data["event_editions"] if item["event_id"] == "event-cmp002")
        self.assertEqual(challenge["year"], 2025)
        self.assertTrue(challenge["id"].endswith("-2025"))

    def test_nothing_is_published_before_manual_review(self):
        self.assertTrue(all(item["data_status"] == "pending_manual_review" for item in self.data["event_editions"]))
        self.assertTrue(all(item["manual_review"] == "pending" for item in self.data["event_editions"]))

    def test_multi_profession_mapping(self):
        links = [item for item in self.data["event_professions"] if item["edition_id"] == "edition-cmp021-2026"]
        self.assertGreaterEqual(len(links), 2)

    def test_more_filter_fields_are_explicit_and_separate(self):
        participation = {"个人赛", "团队赛", "个人或团队均可", "暂未明确"}
        team_sizes = {"1人", "2～3人", "4～5人", "6人及以上", "人数范围不固定", "暂未明确"}
        fees = {"免费", "收费", "不同赛项费用不同", "暂未公布"}
        organizations = {"自行报名", "学校统一报名", "两种方式均可", "需先校内选拔", "以赛区或学校通知为准", "暂未明确"}
        for item in self.data["event_editions"]:
            self.assertIn(item["participation_format"], participation)
            self.assertIn(item["team_size_category"], team_sizes)
            self.assertIn(item["fee_type"], fees)
            self.assertIn(item["registration_organization"], organizations)
            self.assertIn("participation_format", item)
            self.assertIn("registration_organization", item)

    def test_unverified_fee_data_is_not_inferred(self):
        self.assertTrue(all(item["fee_type"] == "暂未公布" for item in self.data["event_editions"]))


if __name__ == "__main__":
    unittest.main()
