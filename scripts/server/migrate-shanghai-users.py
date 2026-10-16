#!/usr/bin/env python3
"""Plan and rehearse user migration in a NEW SQLite database; never edit live DBs.

Source is an authenticated CloudBase export. Missing/partial tables and conflicts
stop the rehearsal. IDs are preserved; destination accounts for the same WeChat
identity are remapped to the source ID. Writes require --staging-db, never --force.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
from datetime import datetime, timezone

USER_TABLES = ['user_account', 'favorite', 'reminder', 'user_preference', 'feedback',
               'general_feedback', 'client_issues', 'client_stats', 'preference_stats']
OWNED = {'favorite', 'reminder', 'user_preference', 'feedback', 'general_feedback'}
PUBLIC_CACHE = 'event_edition_public_cache'


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def row_id(row):
    value = row.get('_id') or row.get('id')
    if not isinstance(value, str) or not value:
        raise ValueError('missing_document_id')
    return value


def ordered(rows):
    return sorted(rows, key=row_id)


def load_source(folder, include_public=False):
    folder = Path(folder)
    manifest = json.loads((folder / 'manifest.json').read_text(encoding='utf-8-sig'))
    tables = {}
    for name in USER_TABLES + ([PUBLIC_CACHE] if include_public else []):
        entry = manifest.get('tables', {}).get(name)
        if not entry:
            raise ValueError('unverified_collection:' + name)
        file = folder / entry['file']
        if file.resolve().parent != folder.resolve():
            raise ValueError('invalid_manifest_path')
        rows = json.loads(file.read_text(encoding='utf-8-sig'))
        if not isinstance(rows, list) or len(rows) != entry['count'] or fingerprint(rows) != entry['hash']:
            raise ValueError('source_hash_or_count_mismatch:' + name)
        if len({row_id(row) for row in rows}) != len(rows):
            raise ValueError('duplicate_document_id:' + name)
        tables[name] = rows
    return tables, manifest


def read_database(connection, collections=None):
    result = {name: [] for name in (collections or USER_TABLES)}
    for collection, identifier, payload in connection.execute('select collection,id,data from documents'):
        if collection in result:
            result[collection].append({**json.loads(payload), '_id': identifier})
    return result


def plan(source, destination, appid):
    conflicts = []
    def issue(kind, collection, identifier):
        conflicts.append({'kind': kind, 'collection': collection, 'record': fingerprint(identifier)[:16]})

    def accounts(rows, origin):
        identities, by_id = {}, {}
        for row in rows:
            identifier = row_id(row)
            identity_app = row.get('appid') or appid
            identity = (identity_app, row.get('openid'))
            if not identity[1] or identity_app != appid:
                issue('invalid_account_identity', origin, identifier)
                continue
            if identity in identities:
                issue('duplicate_wechat_identity', origin, identifier)
            identities[identity] = row
            by_id[identifier] = identity
        return identities, by_id

    source_accounts, source_by_id = accounts(source['user_account'], 'source.user_account')
    target_accounts, target_by_id = accounts(destination['user_account'], 'target.user_account')
    aliases = {}
    for identity, row in target_accounts.items():
        if identity in source_accounts and row_id(row) != row_id(source_accounts[identity]):
            aliases[row_id(row)] = row_id(source_accounts[identity])
    for identifier, identity in source_by_id.items():
        if identifier in target_by_id and identity != target_by_id[identifier]:
            issue('account_id_collision', 'user_account', identifier)

    merged_accounts = {row_id(row): dict(row) for row in destination['user_account'] if row_id(row) not in aliases}
    for identity, source_row in source_accounts.items():
        identifier = row_id(source_row)
        previous = target_accounts.get(identity, {})
        merged = {**previous, **source_row, '_id': identifier}
        if previous.get('status') not in (None, 'active') or source_row.get('status') not in (None, 'active'):
            # A disabled destination account must not become active on import.
            if previous.get('status') != source_row.get('status'):
                issue('account_status_conflict', 'user_account', identifier)
        merged_accounts[identifier] = merged
    known_accounts = set(merged_accounts)
    result = {'user_account': list(merged_accounts.values())}
    remapped = 0
    duplicates = {}
    for name in [key for key in source if key != 'user_account']:
        rows = {}
        for origin, records in [('target', destination[name]), ('source', source[name])]:
            for original in records:
                row = dict(original)
                identifier = row_id(row)
                if name in OWNED:
                    owner = row.get('user_id') or (identifier if name == 'user_preference' else None)
                    if origin == 'target' and owner in aliases:
                        row['user_id'] = aliases[owner]
                        if name == 'user_preference':
                            identifier = aliases[owner]
                            row['_id'] = identifier
                        remapped += 1
                    else:
                        row['user_id'] = owner
                    if row['user_id'] not in known_accounts:
                        issue('orphan_user_record', name, identifier)
                # Exact duplicates collapse. Every nonidentical overlap blocks;
                # silently choosing a timestamp can resurrect removed reminders.
                previous = rows.get(identifier)
                if previous and canonical(previous) != canonical(row):
                    issue('different_document_versions', name, identifier)
                    continue
                if previous:
                    duplicates[name] = duplicates.get(name, 0) + 1
                rows[identifier] = row
        if name == 'favorite':
            by_favorite = {}
            for identifier, row in rows.items():
                identity = (row.get('user_id'), row.get('edition_id'))
                if identity in by_favorite:
                    # Do not silently pick one timestamp or document ID.
                    issue('duplicate_favorite_identity', name, identifier)
                by_favorite[identity] = identifier
        if name == 'reminder':
            by_reminder = {}
            for identifier, row in rows.items():
                identity = (row.get('user_id'), row.get('id') or identifier)
                if identity in by_reminder:
                    issue('duplicate_reminder_identity', name, identifier)
                by_reminder[identity] = identifier
        result[name] = list(rows.values())
    profiles = []
    for identifier in sorted(known_accounts):
        profiles.append({'account': fingerprint(identifier)[:16],
                         'collections': {name: {'count': len(owned := [row for row in result[name] if row.get('user_id') == identifier]),
                                                'hash': fingerprint(ordered(owned))}
                                         for name in sorted(OWNED)}})
    report = {'createdAt': datetime.now(timezone.utc).isoformat(),
              'sourceCounts': {name: len(rows) for name, rows in source.items()},
              'targetCounts': {name: len(rows) for name, rows in destination.items()},
              'plannedCounts': {name: len(rows) for name, rows in result.items()},
              'accountMappings': len(aliases), 'remappedOwnedDocuments': remapped,
              'exactDuplicates': duplicates, 'conflicts': conflicts, 'perAccount': profiles,
              'plannedHashes': {name: fingerprint(ordered(rows)) for name, rows in result.items()},
              'readyForRehearsal': not conflicts, 'readyForCutover': False}
    return result, report, aliases


def write_staging(target, staging, merged, report):
    if report['conflicts']:
        raise ValueError('conflicts_require_manual_resolution')
    destination = Path(staging)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(destination, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    db = sqlite3.connect(destination)
    try:
        target.backup(db)
        with db:
            seq = db.execute('select coalesce(max(seq),0) from documents').fetchone()[0]
            for name, rows in merged.items():
                db.execute('delete from documents where collection=?', (name,))
                for row in rows:
                    identifier = row_id(row)
                    payload = {key: value for key, value in row.items() if key != '_id'}
                    seq += 1
                    db.execute('insert into documents(collection,id,data,seq) values(?,?,?,?)',
                               (name, identifier, canonical(payload), seq))
            db.execute("insert into seq_counter(name,value) values('doc',?) on conflict(name) do update set value=excluded.value", (seq,))
        actual = read_database(db, merged.keys())
        hashes = {name: fingerprint(ordered(rows)) for name, rows in actual.items()}
        if hashes != report['plannedHashes']:
            raise ValueError('staging_readback_hash_mismatch')
        if db.execute('pragma integrity_check').fetchone()[0] != 'ok':
            raise ValueError('staging_integrity_failed')
        report['stagingVerified'] = True
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--target-db', required=True)
    parser.add_argument('--appid', required=True)
    parser.add_argument('--report', required=True)
    parser.add_argument('--staging-db')
    parser.add_argument('--with-public-cache', action='store_true')
    args = parser.parse_args()
    source, manifest = load_source(args.source, args.with_public_cache)
    target_path = Path(args.target_db).resolve()
    if args.staging_db and Path(args.staging_db).resolve() == target_path:
        raise ValueError('staging_must_not_be_target_database')
    target = sqlite3.connect(target_path.as_uri() + '?mode=ro', uri=True)
    try:
        merged, report, aliases = plan(source, read_database(target, source.keys()), args.appid)
        report['sourceEnvironment'] = manifest.get('environment')
        report['consistentSnapshot'] = manifest.get('consistentSnapshot') is True
        output = Path(args.report)
        output.parent.mkdir(parents=True, exist_ok=True)
        # Account mapping is private data, kept in a separate restricted file.
        mapping = output.with_suffix('.private-account-map.json')
        mapping.write_text(json.dumps(aliases, indent=2), encoding='utf-8')
        os.chmod(mapping, 0o600)
        if args.staging_db and not report['conflicts']:
            write_staging(target, args.staging_db, merged, report)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(json.dumps({key: report[key] for key in ['sourceCounts', 'targetCounts', 'plannedCounts', 'accountMappings', 'readyForRehearsal', 'readyForCutover']}))
        print('conflicts=' + str(len(report['conflicts'])))
        return 1 if report['conflicts'] else 0
    finally:
        target.close()


if __name__ == '__main__':
    raise SystemExit(main())
