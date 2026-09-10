from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_PATH = Path(__file__).with_name("sync-app-store-release.py")
SPEC = importlib.util.spec_from_file_location("sync_app_store_release", SCRIPT_PATH)
assert SPEC and SPEC.loader
sync = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = sync
SPEC.loader.exec_module(sync)


class VersionTests(unittest.TestCase):
    def test_semantic_version_validation_and_equality(self):
        self.assertEqual(sync.parse_version("1.1.12"), (1, 1, 12))
        self.assertTrue(sync.versions_equal("1.2", "1.2.0"))
        self.assertIsNone(sync.parse_version("1.2-beta"))


class AppStoreTests(unittest.TestCase):
    def test_bundle_id_mismatch_fails(self):
        response = {
            "resultCount": 1,
            "results": [{"bundleId": "wrong.bundle", "version": "1.1.12"}],
        }
        with patch.object(sync, "request_json", return_value=response):
            with self.assertRaisesRegex(sync.SyncError, "Bundle ID mismatch"):
                sync.read_app_store_version()


class VercelTests(unittest.TestCase):
    def setUp(self):
        self.environ = patch.dict(
            os.environ,
            {
                "VERCEL_TOKEN": "test-token",
                "VERCEL_PROJECT_ID": "project-id",
            },
            clear=False,
        )
        self.environ.start()

    def tearDown(self):
        self.environ.stop()

    def test_reads_only_latest_ios_environment_variable(self):
        responses = [
            {
                "envs": [
                    {"id": "min-id", "key": "MIN_IOS_VERSION", "target": ["production"]},
                    {"id": "latest-id", "key": "LATEST_IOS_VERSION", "target": ["production"]},
                ]
            },
            {"value": "1.1.12"},
        ]
        with patch.object(sync, "request_json", side_effect=responses) as request:
            self.assertEqual(sync.read_vercel_latest(), ("1.1.12", "latest-id"))
            self.assertIn("latest-id", request.call_args_list[1].args[0])

    def test_update_changes_only_latest_value(self):
        with patch.object(sync, "request_json", return_value={}) as request:
            sync.update_vercel_latest("latest-id", "1.1.13")
        call = request.call_args
        self.assertIn("latest-id", call.args[0])
        self.assertEqual(call.kwargs["body"], {"value": "1.1.13", "target": ["production"]})
        self.assertNotIn("MIN_IOS_VERSION", repr(call))


class SyncFlowTests(unittest.TestCase):
    def test_same_version_is_idempotent_no_op(self):
        with (
            patch.object(sync, "read_app_store_version", return_value="1.1.12"),
            patch.object(sync, "read_public_latest", return_value="1.1.12"),
            patch.object(sync, "read_vercel_latest", return_value=("1.1.12", "env-id")),
            patch.object(sync, "update_vercel_latest") as update,
            patch.object(sync, "call_deploy_hook") as deploy,
        ):
            outcome = sync.sync_release()
        self.assertEqual(outcome.action, "no-op; Vercel and public API are already current")
        self.assertTrue(outcome.verified)
        update.assert_not_called()
        deploy.assert_not_called()

    def test_different_version_updates_latest_and_deploys(self):
        with (
            patch.object(sync, "read_app_store_version", return_value="1.1.13"),
            patch.object(sync, "read_public_latest", return_value="1.1.12"),
            patch.object(sync, "read_vercel_latest", return_value=("1.1.12", "env-id")),
            patch.object(sync, "update_vercel_latest") as update,
            patch.object(sync, "call_deploy_hook") as deploy,
            patch.object(sync, "verify_redeployment") as verify,
        ):
            outcome = sync.sync_release()
        update.assert_called_once_with("env-id", "1.1.13")
        deploy.assert_called_once_with()
        verify.assert_called_once_with("1.1.13")
        self.assertTrue(outcome.changed)
        self.assertTrue(outcome.deploy_hook_called)

    def test_public_verification_failure_fails(self):
        with self.assertRaisesRegex(sync.SyncError, "did not expose"):
            sync.verify_redeployment(
                "1.1.13",
                attempts=2,
                interval=0,
                read_latest=lambda: "1.1.12",
                sleep=lambda _seconds: None,
            )

    def test_dry_run_never_changes_external_state(self):
        with (
            patch.object(sync, "read_app_store_version", return_value="1.1.13"),
            patch.object(sync, "read_public_latest", return_value="1.1.12"),
            patch.object(sync, "read_vercel_latest") as read_vercel,
            patch.object(sync, "update_vercel_latest") as update,
            patch.object(sync, "call_deploy_hook") as deploy,
        ):
            outcome = sync.sync_release(dry_run=True)
        self.assertEqual(outcome.action, "dry-run; no Vercel changes or deployment")
        read_vercel.assert_not_called()
        update.assert_not_called()
        deploy.assert_not_called()


if __name__ == "__main__":
    unittest.main()
