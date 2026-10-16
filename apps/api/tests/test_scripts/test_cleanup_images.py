"""Run without services: python apps/api/tests/test_scripts/test_cleanup_images.py."""

import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[4]
SPEC = importlib.util.spec_from_file_location("cleanup_images", ROOT / "scripts/oracle/cleanup_images.py")
cleanup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cleanup)
ROLLBACK = "sha256:" + "a" * 64
PREPARED = "sha256:" + "b" * 64


def image(number, tags=None, workdir=""):
    return {
        "Id": "sha256:" + f"{number:064x}", "Created": f"2026-10-{number:02d}T00:00:00Z",
        "Size": number, "RepoTags": tags or [], "RepoDigests": [], "Config": {"WorkingDir": workdir},
    }


class CleanupImagesTest(unittest.TestCase):
    def test_retains_newest_two_per_family_and_every_protected_image(self):
        images = [image(i, [f"example/api:r{i}"]) for i in range(1, 6)]
        images += [image(i, workdir="/app/VCIDataPlatform") for i in range(6, 10)]
        images += [image(10, workdir="/unrelated"), image(11, ["other/api:release"])]
        protected = {images[0]["Id"], images[5]["Id"]}
        records = cleanup.inventory(images, protected, {"example/api"}, 2, {"/app/VCIDataPlatform"})
        self.assertEqual({r["id"] for r in records if r["action"] == "remove"}, {images[i]["Id"] for i in (1, 2, 6)})

    def test_shared_unselected_repository_and_tagged_ci_images_are_not_removed(self):
        images = [image(1, ["example/api:old", "unrelated/api:saved"]), image(2, ["ci:old"], "/app/VCIDataPlatform")]
        records = cleanup.inventory(images, set(), {"example/api"}, 0, {"/app/VCIDataPlatform"})
        self.assertTrue(all(record["action"] == "keep" for record in records))

    def run_main(self, apply=False, race=False, missing=False, fail_remove=False, multiple=False, tagged=False):
        old = image(1)
        if multiple:
            old["RepoTags"] = ["example/api:old", "example/api:older"]
        elif tagged:
            old["RepoTags"] = ["example/api:old"]
        calls = []
        container_checks = 0

        def docker(*args):
            nonlocal container_checks
            calls.append(args)
            if args == ("container", "ls", "--all", "--quiet"):
                container_checks += 1
                return "new-container" if race and container_checks > 1 else ""
            if args[:2] == ("container", "inspect"):
                return json.dumps([{"Image": old["Id"]}])
            if args[:2] == ("image", "inspect"):
                if missing and args[-1] == PREPARED:
                    raise subprocess.CalledProcessError(1, args, stderr="missing prepared image")
                return json.dumps([old if args[-1] == old["Id"] or args[-1] in old["RepoTags"] else {"Id": args[-1]}])
            if args[:2] == ("image", "ls"):
                return old["Id"]
            if fail_remove:
                raise subprocess.CalledProcessError(1, args, stderr="image is in use")
            return ""

        argv = ["cleanup_images.py", "--repository", "example/api", "--workdir", "/app/VCIDataPlatform", "--keep", "0",
                "--rollback-image", ROLLBACK, "--prepared-image", PREPARED]
        old["Config"]["WorkingDir"] = "/app/VCIDataPlatform"
        if apply:
            argv.append("--apply")
        output = io.StringIO()
        with patch.object(sys, "argv", argv), patch.object(cleanup, "docker", side_effect=docker), contextlib.redirect_stdout(output):
            cleanup.main()
        return calls, output.getvalue(), old

    def test_defaults_to_inventory_and_never_removes(self):
        calls, output, old = self.run_main()
        self.assertFalse(any(call[:2] == ("image", "rm") for call in calls))
        self.assertEqual(json.loads(output)["images"][0]["id"], old["Id"])
        self.assertEqual(json.loads(output)["mode"], "plan")

    def test_apply_removes_only_immutable_ids_without_force_or_parent_pruning(self):
        for tagged in (False, True):
            with self.subTest(tagged=tagged):
                calls, output, old = self.run_main(apply=True, tagged=tagged)
                self.assertEqual([call for call in calls if call[:2] == ("image", "rm")],
                                 [("image", "rm", "--no-prune", old["Id"])])
                self.assertEqual(json.loads(output.splitlines()[-1]), {"removed": old["Id"]})

    def test_apply_withholds_multi_reference_images(self):
        calls, output, _ = self.run_main(apply=True, multiple=True)
        self.assertFalse(any(call[:2] == ("image", "rm") for call in calls))
        record = json.loads(output)["images"][0]
        self.assertEqual(record["action"], "keep")
        self.assertIn("multiple references withheld", record["reason"])

    def test_new_container_reference_stops_apply(self):
        with self.assertRaisesRegex(RuntimeError, "became container-referenced"):
            self.run_main(apply=True, race=True)

    def test_missing_protected_image_and_delete_failures_are_not_suppressed(self):
        for options in ({"missing": True}, {"apply": True, "fail_remove": True}):
            with self.subTest(options=options), self.assertRaises(subprocess.CalledProcessError):
                self.run_main(**options)

    def test_mongo_compose_probes_have_init_exec_and_deadlines(self):
        for filename in ("docker-compose.oracle.yml", "docker-compose.data.local.yml"):
            source = (ROOT / filename).read_text()
            mongo = source.split("\n  mongo:\n", 1)[1].split("\n  redis:", 1)[0]
            self.assertIn("    init: true", mongo)
            self.assertIn("exec mongosh", mongo)
            self.assertIn("serverSelectionTimeoutMS=2000&connectTimeoutMS=2000", mongo)
            self.assertIn("      timeout: 5s", mongo)
            self.assertIn('$$MONGO_INITDB_ROOT_PASSWORD', mongo)

    def test_native_timer_requires_private_protection_and_bounds_each_run(self):
        service = (ROOT / "deployment/vnibb-image-retention.service").read_text()
        timer = (ROOT / "deployment/vnibb-image-retention.timer").read_text()
        self.assertIn("Type=oneshot", service)
        self.assertIn("EnvironmentFile=/etc/vnibb/image-retention.env", service)
        self.assertNotIn("EnvironmentFile=-", service)
        self.assertIn("--rollback-image ${VNIBB_ROLLBACK_IMAGE}", service)
        self.assertIn("--prepared-image ${VNIBB_PREPARED_IMAGE}", service)
        self.assertIn("--repository ghcr.io/kohnnn/vnibb-api --workdir /app/VCIDataPlatform", service)
        self.assertIn("--keep 2 --apply", service)
        self.assertIn("TimeoutStartSec=300", service)
        self.assertIn("Nice=19", service)
        self.assertIn("IOSchedulingClass=idle", service)
        self.assertIn("OnCalendar=daily", timer)
        self.assertIn("Persistent=true", timer)
        self.assertIn("Unit=vnibb-image-retention.service", timer)


if __name__ == "__main__":
    unittest.main()
