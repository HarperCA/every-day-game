from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / "data" / "seed" / "competitions.json"
COLLECTION_MAP = {
    "profession_categories": "profession_category",
    "event_masters": "event_master",
    "event_editions": "event_edition",
    "event_tracks": "event_track",
    "event_schedules": "event_schedule",
    "data_sources": "data_source",
    "event_professions": "event_profession",
    "recommendations": "recommendation",
}
EMPTY_COLLECTIONS = ["favorite", "reminder", "feedback", "ai_job", "audit_log"]
STATUS_WEIGHT = {"报名中": 0, "即将报名": 1, "时间待公布": 2, "已截止": 3}
RECOMMENDATION_WEIGHT = {"强烈推荐": 0, "值得参加": 1, "适合练手": 2, "高难挑战": 3, "谨慎报名": 4, "信息不足": 5}


def registration_status(schedule: dict, now: datetime) -> str:
    if schedule.get("status_override"):
        return schedule["status_override"]
    start = datetime.fromisoformat(schedule["registration_start"]) if schedule.get("registration_start") else None
    end = datetime.fromisoformat(schedule["registration_end"]) if schedule.get("registration_end") else None
    if not start:
        return "时间待公布"
    if now < start:
        return "即将报名"
    if end and now > end:
        return "已截止"
    return "报名中"


def build_public_cache(data: dict, now: datetime | None = None) -> list[dict]:
    now = now or datetime.now(timezone.utc)
    masters = {item["id"]: item for item in data["event_masters"]}
    schedules = {item["edition_id"]: item for item in data["event_schedules"]}
    recommendations = {item["edition_id"]: item for item in data["recommendations"]}
    profession_names = {item["id"]: item["name"] for item in data["profession_categories"]}
    professions: dict[str, list[str]] = {}
    for link in data["event_professions"]:
        professions.setdefault(link["edition_id"], []).append(profession_names[link["profession_id"]])
    records: list[dict] = []
    for edition in data["event_editions"]:
        if not (edition.get("data_status") == "published" and edition.get("system_validation") == "passed" and edition.get("manual_review") == "passed"):
            continue
        schedule = schedules[edition["id"]]
        master = masters[edition["event_id"]]
        recommendation = recommendations[edition["id"]]
        status = registration_status(schedule, now)
        recommendation_value = recommendation["recommendation"]
        aliases = master.get("aliases", [])
        records.append({
            "id": edition["id"],
            "event_id": edition["event_id"],
            "name": master["standard_name"],
            "edition_name": edition["edition_name"],
            "aliases": aliases,
            "organizer": edition["organizer"],
            "registration_status": status,
            "event_level": edition["event_level"],
            "professions": professions.get(edition["id"], []),
            "participation_format": edition["participation_format"],
            "team_size_category": edition["team_size_category"],
            "fee_type": edition["fee_type"],
            "registration_organization": edition["registration_organization"],
            "registration_start": schedule.get("registration_start"),
            "registration_end": schedule.get("registration_end"),
            "recommendation": recommendation_value,
            "recommendation_reasons": recommendation.get("reasons", []),
            "last_verified_at": edition["last_verified_at"],
            "search_text": " ".join([master["standard_name"], edition["edition_name"], edition["organizer"], *aliases, *master.get("objective_tags", [])]).lower(),
            "sort_weight": STATUS_WEIGHT[status] * 100 + RECOMMENDATION_WEIGHT[recommendation_value] * 10 + len(edition.get("quality_issues", [])),
            "data_status": "published",
            "system_validation": "passed",
            "manual_review": "passed",
        })
    return records


def write_jsonl(target: Path, records: list[dict]) -> None:
    payload = "\n".join(json.dumps(item, ensure_ascii=False) for item in records)
    target.write_text(payload + ("\n" if payload else ""), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Prepare validated CloudBase collection import files")
    parser.add_argument("--dry-run", action="store_true", help="Only show collection counts")
    parser.add_argument("--require-env", action="store_true", help="Require CLOUDBASE_ENV_ID before preparing files")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "data" / "cloudbase-import")
    args = parser.parse_args()
    data = json.loads(SEED.read_text(encoding="utf-8"))
    public_cache = build_public_cache(data)
    counts = {collection: len(data[key]) for key, collection in COLLECTION_MAP.items()}
    counts["event_edition_public_cache"] = len(public_cache)
    counts.update({collection: 0 for collection in EMPTY_COLLECTIONS})
    for collection, count in counts.items():
        print(f"{collection}: {count}")
    if args.dry_run:
        print("dry-run only; no files or cloud data written")
        return
    env_id = os.getenv("CLOUDBASE_ENV_ID", "").strip()
    if args.require_env and not env_id:
        raise SystemExit("CLOUDBASE_ENV_ID is required with --require-env")
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for key, collection in COLLECTION_MAP.items():
        write_jsonl(args.output_dir / f"{collection}.jsonl", data[key])
    write_jsonl(args.output_dir / "event_edition_public_cache.jsonl", public_cache)
    for collection in EMPTY_COLLECTIONS:
        write_jsonl(args.output_dir / f"{collection}.jsonl", [])
    manifest = {
        "schema_version": "1.1.0",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cloudbase_env_id": env_id or None,
        "counts": counts,
        "public_cache_release_gate": "published + system_validation passed + manual_review passed",
        "upload_performed": False,
    }
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"prepared JSONL files and manifest in {args.output_dir}; no remote upload was performed")


if __name__ == "__main__":
    main()
