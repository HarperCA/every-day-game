import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('migration', Path(__file__).parents[1] / 'scripts/server/migrate-shanghai-users.py')
M = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(M)


class UserMigrationTests(unittest.TestCase):
    def blank(self):
        return {name: [] for name in M.USER_TABLES}

    def test_remaps_all_owned_records_and_retains_reminder_authorization(self):
        source, target = self.blank(), self.blank()
        source['user_account'] = [{'_id': 'shanghai', 'openid': 'identity', 'appid': 'app', 'status': 'active'}]
        target['user_account'] = [{'_id': 'beijing', 'openid': 'identity', 'appid': 'app', 'status': 'active'}]
        target['reminder'] = [{'_id': 'r1', 'id': 'r1', 'user_id': 'beijing', 'sent_at': '2026-01-01', 'subscription_status': 'accepted'}]
        target['user_preference'] = [{'_id': 'beijing', 'user_id': 'beijing', 'province': '安徽省'}]
        merged, report, aliases = M.plan(source, target, 'app')
        self.assertFalse(report['conflicts'])
        self.assertEqual(aliases, {'beijing': 'shanghai'})
        self.assertEqual(merged['reminder'][0]['user_id'], 'shanghai')
        self.assertEqual(merged['reminder'][0]['sent_at'], '2026-01-01')
        self.assertEqual(merged['reminder'][0]['subscription_status'], 'accepted')
        self.assertEqual(merged['user_preference'][0]['_id'], 'shanghai')

    def test_duplicate_wechat_identity_and_orphans_block(self):
        source, target = self.blank(), self.blank()
        source['user_account'] = [{'_id': 'a', 'openid': 'x'}, {'_id': 'b', 'openid': 'x'}]
        source['favorite'] = [{'_id': 'f', 'user_id': 'unknown', 'edition_id': 'e'}]
        _, report, _ = M.plan(source, target, 'app')
        self.assertEqual({c['kind'] for c in report['conflicts']}, {'duplicate_wechat_identity', 'orphan_user_record'})

    def test_status_mismatch_never_enables_disabled_user(self):
        source, target = self.blank(), self.blank()
        source['user_account'] = [{'_id': 'a', 'openid': 'x', 'status': 'active'}]
        target['user_account'] = [{'_id': 'a', 'openid': 'x', 'status': 'disabled'}]
        _, report, _ = M.plan(source, target, 'app')
        self.assertIn('account_status_conflict', {c['kind'] for c in report['conflicts']})

    def test_different_reminder_versions_block_and_exact_replay_is_idempotent(self):
        source, target = self.blank(), self.blank()
        account = {'_id': 'a', 'openid': 'x', 'status': 'active'}
        source['user_account'] = [account]
        source['reminder'] = [{'_id': 'r', 'user_id': 'a', 'sent_at': None}]
        target['user_account'] = [account]
        target['reminder'] = [{'_id': 'r', 'user_id': 'a', 'sent_at': '2026-01-01'}]
        _, report, _ = M.plan(source, target, 'app')
        self.assertEqual(report['conflicts'][0]['kind'], 'different_document_versions')
        merged, first, _ = M.plan(source, self.blank(), 'app')
        _, replay, _ = M.plan(source, merged, 'app')
        self.assertFalse(replay['conflicts'])
        self.assertEqual(first['plannedHashes'], replay['plannedHashes'])

    def test_staging_keeps_other_tables_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as folder:
            target = sqlite3.connect(Path(folder) / 'target.db')
            target.executescript('create table documents(collection text,id text,data text,seq integer,primary key(collection,id)); create table seq_counter(name text primary key,value integer);')
            target.execute('insert into documents values(?,?,?,?)', ('admin_state', 'competitions', '{}', 1))
            target.commit()
            source = self.blank()
            source['user_account'] = [{'_id': 'a', 'openid': 'x', 'status': 'active'}]
            merged, report, _ = M.plan(source, self.blank(), 'app')
            staging = Path(folder) / 'stage.db'
            M.write_staging(target, staging, merged, report)
            self.assertTrue(report['stagingVerified'])
            read = sqlite3.connect(staging)
            self.assertEqual(read.execute("select count(*) from documents where collection='admin_state'").fetchone()[0], 1)
            self.assertEqual(target.execute('select count(*) from documents').fetchone()[0], 1)
            read.close()
            with self.assertRaises(FileExistsError):
                M.write_staging(target, staging, merged, report)
            target.close()

    def test_public_cache_import_preserves_original_status_and_fields(self):
        source, target = self.blank(), self.blank()
        source[M.PUBLIC_CACHE] = [{'_id': 'edition-1', 'id': 'edition-1', 'data_status': 'archived',
                                   'manual_review': 'passed', 'system_validation': 'passed', 'title': '比赛',
                                   'registration_end': '2026-10-12'}]
        target[M.PUBLIC_CACHE] = []
        merged, report, _ = M.plan(source, target, 'app')
        self.assertFalse(report['conflicts'])
        self.assertEqual(merged[M.PUBLIC_CACHE], source[M.PUBLIC_CACHE])
        self.assertEqual(report['plannedHashes'][M.PUBLIC_CACHE], M.fingerprint(M.ordered(source[M.PUBLIC_CACHE])))


if __name__ == '__main__':
    unittest.main()
