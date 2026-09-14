from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "seed" / "competitions.json"
RECOMMENDATIONS = {"强烈推荐", "值得参加", "适合练手", "高难挑战", "谨慎报名", "信息不足"}
STATUSES = {"时间待公布", "即将报名", "报名中", "已截止", None}
PARTICIPATION_FORMATS = {"个人赛", "团队赛", "个人或团队均可", "暂未明确"}
TEAM_SIZE_CATEGORIES = {"1人", "2～3人", "4～5人", "6人及以上", "人数范围不固定", "暂未明确"}
FEE_TYPES = {"免费", "收费", "不同赛项费用不同", "暂未公布"}
REGISTRATION_ORGANIZATIONS = {"自行报名", "学校统一报名", "两种方式均可", "需先校内选拔", "以赛区或学校通知为准", "暂未明确"}


def valid_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def validate(data: dict) -> list[str]:
    errors: list[str] = []
    editions = data.get("event_editions", [])
    if len(editions) != 30:
        errors.append(f"expected 30 editions, got {len(editions)}")
    for collection in ("event_masters", "event_editions", "event_tracks", "event_schedules", "data_sources", "recommendations"):
        ids = [item.get("id") for item in data.get(collection, [])]
        if len(ids) != len(set(ids)):
            errors.append(f"duplicate id in {collection}")

    schedules = {item["edition_id"]: item for item in data.get("event_schedules", [])}
    sources_by_edition: dict[str, list[dict]] = {}
    for source in data.get("data_sources", []):
        sources_by_edition.setdefault(source["edition_id"], []).append(source)
        if source.get("url") and not valid_url(source["url"]):
            errors.append(f"invalid source URL: {source['id']}")

    recommendations = {item["edition_id"]: item for item in data.get("recommendations", [])}
    for edition in editions:
        edition_id = edition["id"]
        enum_fields = {
            "participation_format": PARTICIPATION_FORMATS,
            "team_size_category": TEAM_SIZE_CATEGORIES,
            "fee_type": FEE_TYPES,
            "registration_organization": REGISTRATION_ORGANIZATIONS,
        }
        for field, allowed in enum_fields.items():
            if edition.get(field) not in allowed:
                errors.append(f"invalid {field}: {edition_id}")
        schedule = schedules.get(edition_id)
        if not schedule:
            errors.append(f"missing schedule: {edition_id}")
            continue
        start, end = schedule.get("registration_start"), schedule.get("registration_end")
        if start and end and datetime.fromisoformat(end) < datetime.fromisoformat(start):
            errors.append(f"registration end before start: {edition_id}")
        if schedule.get("status_override") not in STATUSES:
            errors.append(f"invalid status override: {edition_id}")
        if schedule.get("status_override") and not schedule.get("status_override_reason"):
            errors.append(f"status override missing reason: {edition_id}")

        rec = recommendations.get(edition_id)
        if not rec:
            errors.append(f"missing recommendation: {edition_id}")
        else:
            if rec.get("recommendation") not in RECOMMENDATIONS:
                errors.append(f"invalid recommendation: {edition_id}")
            if not rec.get("reasons") or not rec.get("evidence_refs"):
                errors.append(f"recommendation lacks evidence: {edition_id}")
            if len(rec.get("reasons", [])) > 3 or len(rec.get("limitations", [])) > 3:
                errors.append(f"recommendation list too long: {edition_id}")

        if edition.get("data_status") == "published":
            official = [source for source in sources_by_edition.get(edition_id, []) if source.get("is_official") and source.get("validity_status") == "valid"]
            required = [edition.get("edition_name"), edition.get("organizer"), edition.get("participants"), edition.get("format_and_rules"), edition.get("registration_method"), edition.get("registration_url"), edition.get("last_verified_at")]
            if not all(required) or not official:
                errors.append(f"published edition misses release gate: {edition_id}")
            if edition.get("system_validation") != "passed" or edition.get("manual_review") != "passed":
                errors.append(f"published edition lacks approvals: {edition_id}")

    return errors


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    args = parser.parse_args()
    data = json.loads(args.input.read_text(encoding="utf-8"))
    errors = validate(data)
    if errors:
        print("\n".join(errors))
        raise SystemExit(1)
    print(f"validation passed: editions={len(data['event_editions'])}, preview_only={data['meta']['development_preview_only']}")


if __name__ == "__main__":
    main()
