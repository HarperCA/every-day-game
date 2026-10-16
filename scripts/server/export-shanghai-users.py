#!/usr/bin/env python3
"""Read-only CloudBase snapshot via authenticated CLI; never prints private rows."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from datetime import datetime, timezone

COLLECTIONS = ['user_account', 'favorite', 'reminder', 'user_preference', 'feedback',
               'general_feedback', 'client_issues', 'client_stats', 'preference_stats', 'admin_state',
               'event_edition_public_cache']


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def export(env, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest = {'environment': env, 'exportedAt': datetime.now(timezone.utc).isoformat(),
                'consistentSnapshot': False, 'tables': {}, 'errors': []}
    # Collection listing distinguishes truly absent collections from permission/network failures.
    command = [{'TableName': 'user_account', 'CommandType': 'COMMAND',
                'Command': json.dumps({'listCollections': 1, 'nameOnly': True})}]
    listing = subprocess.run(['tcb', 'db', 'nosql', 'execute', '-e', env, '--command', json.dumps(command), '--json'],
                             capture_output=True, text=True, timeout=180)
    (output / 'collection-inventory.json').write_text(listing.stdout, encoding='utf-8')
    if listing.returncode:
        raise RuntimeError('collection_inventory_failed')
    inventory = json.loads(listing.stdout)['data']['results']
    present = {row['name'] for group in inventory for row in group}
    manifest['presentCollections'] = sorted(present)
    for name in COLLECTIONS:
        destination = output / name
        destination.mkdir(exist_ok=True, mode=0o700)
        try:
            if name not in present:
                if name in ('user_account', 'favorite', 'reminder', 'user_preference'):
                    raise RuntimeError('required_collection_missing')
                rows = []
                (output / (name + '.json')).write_text('[]', encoding='utf-8')
                manifest['tables'][name] = {'count': 0, 'hash': hashlib.sha256(canonical(rows).encode()).hexdigest(),
                                            'file': name + '.json', 'absentAtExport': True}
                print(name + ': absent (verified by inventory)', flush=True)
                continue
            result = subprocess.run(['tcb', 'db', 'nosql', 'dump', name, '-e', env,
                                     '--output-dir', str(destination), '--json'], capture_output=True, text=True, timeout=240)
            if result.returncode:
                # CLI errors can include a signed download URL: never persist it.
                raise RuntimeError('export_failed:exit_' + str(result.returncode))
            files = list(destination.glob('*.json'))
            if len(files) != 1:
                raise RuntimeError('expected_one_export_file')
            raw = files[0].read_text(encoding='utf-8-sig')
            try:
                rows = json.loads(raw)
            except ValueError:
                rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
            if not isinstance(rows, list):
                raise RuntimeError('export_is_not_array')
            (output / (name + '.json')).write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
            manifest['tables'][name] = {'count': len(rows), 'hash': hashlib.sha256(canonical(rows).encode()).hexdigest(), 'file': name + '.json'}
            print(name + ': ' + str(len(rows)), flush=True)
        except Exception as error:
            manifest['errors'].append({'collection': name, 'error': str(error)[:200]})
            print(name + ': export incomplete', flush=True)
        finally:
            (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    manifest['completedAt'] = datetime.now(timezone.utc).isoformat()
    (output / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--env', required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    export(args.env, args.out)
