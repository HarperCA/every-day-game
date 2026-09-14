import copy
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from scripts.import_seed import build_public_cache

try:
    from jsonschema import validate as validate_json_schema
except ImportError:
    validate_json_schema = None


ROOT = Path(__file__).resolve().parents[1]


class CloudBaseImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.seed = json.loads((ROOT / "data/seed/competitions.json").read_text(encoding="utf-8"))

    def test_unreviewed_seed_never_enters_public_cache(self):
        self.assertEqual(build_public_cache(self.seed, datetime(2026, 8, 20, tzinfo=timezone.utc)), [])

    def test_release_gate_builds_filterable_public_document(self):
        data = copy.deepcopy(self.seed)
        edition = data["event_editions"][0]
        edition["data_status"] = "published"
        edition["system_validation"] = "passed"
        edition["manual_review"] = "passed"
        cache = build_public_cache(data, datetime(2026, 8, 20, tzinfo=timezone.utc))
        self.assertEqual(len(cache), 1)
        document = cache[0]
        for field in ("participation_format", "team_size_category", "fee_type", "registration_organization", "search_text", "sort_weight"):
            self.assertIn(field, document)
        self.assertEqual(document["data_status"], "published")
        if validate_json_schema:
            schema = json.loads((ROOT / "database/schemas/event_edition_public_cache.schema.json").read_text(encoding="utf-8"))
            validate_json_schema(document, schema)

    def test_database_schema_files_are_valid_json(self):
        collections = json.loads((ROOT / "database/collections.json").read_text(encoding="utf-8"))
        for relative_path in collections["schemas"].values():
            schema = json.loads((ROOT / "database" / relative_path).read_text(encoding="utf-8"))
            self.assertEqual(schema["type"], "object")
        for relative_path in collections.get("contracts", {}).values():
            schema = json.loads((ROOT / "database" / relative_path).read_text(encoding="utf-8"))
            self.assertEqual(schema["type"], "object")


if __name__ == "__main__":
    unittest.main()
