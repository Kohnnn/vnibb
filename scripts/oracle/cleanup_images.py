#!/usr/bin/env python3
"""Inventory and explicitly apply count-bounded unused release image retention."""

import argparse
import json
import re
import subprocess
import sys

IMMUTABLE_IMAGE = re.compile(r"(?:[^\s]+@)?sha256:[a-fA-F0-9]{64}")


def docker(*args):
    result = subprocess.run(["docker", *args], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def container_images():
    containers = docker("container", "ls", "--all", "--quiet").splitlines()
    return {
        json.loads(docker("container", "inspect", container))[0]["Image"]
        for container in containers
    }


def repository(reference):
    return reference.split("@", 1)[0] if "@" in reference else reference.rsplit(":", 1)[0]


def inventory(images, protected, repositories, keep, workdirs):
    records = []
    groups = {}
    for image in images:
        references = (image.get("RepoTags") or []) + (image.get("RepoDigests") or [])
        owners = {repository(reference) for reference in references}
        workdir = image.get("Config", {}).get("WorkingDir", "")
        record = {
            "id": image["Id"], "created": image["Created"], "bytes": image["Size"],
            "references": references, "workdir": workdir,
            "action": "keep", "reason": "outside configured families",
        }
        records.append(record)
        if image["Id"] in protected:
            record["reason"] = "container, rollback or prepared image"
        elif len(references) > 1:
            record["reason"] = "multiple references withheld; review manually"
        elif owners and owners <= repositories:
            record["reason"] = "retention"
            for owner in owners:
                groups.setdefault(owner, []).append(record)
        elif not owners and workdir in workdirs:
            record["reason"] = "retention"
            groups.setdefault(f"workdir:{workdir}", []).append(record)
    retained = set()
    for group in groups.values():
        retained.update(item["id"] for item in sorted(group, key=lambda item: item["created"], reverse=True)[:keep])
    for record in records:
        if record["reason"] == "retention" and record["id"] not in retained:
            record["action"] = "remove"
    return records


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", action="append", default=[], help="exact repository, without tag/digest; repeatable")
    parser.add_argument("--rollback-image", required=True, help="locally available immutable digest or full image ID")
    parser.add_argument("--prepared-image", required=True, help="locally available immutable digest or full image ID")
    parser.add_argument("--keep", type=int, default=2, help="newest unused images per family (default: 2), in addition to protected IDs")
    parser.add_argument("--workdir", action="append", default=[], help="exact WorkingDir of untagged CI images only; repeatable")
    parser.add_argument("--apply", action="store_true", help="remove inventoried candidates; default only prints the plan")
    args = parser.parse_args()
    if args.keep < 0 or any(not value or "@" in value or ":" in value.rsplit("/", 1)[-1] for value in args.repository):
        parser.error("--keep must be nonnegative and --repository must omit tags/digests")
    if not (args.repository or args.workdir) or any(not value.startswith("/") for value in args.workdir):
        parser.error("provide --repository or an absolute --workdir")
    if not all(IMMUTABLE_IMAGE.fullmatch(value) for value in (args.rollback_image, args.prepared_image)):
        parser.error("rollback and prepared images must use full sha256 IDs or repository@sha256 digests")
    protected = container_images()
    for reference in (args.rollback_image, args.prepared_image):
        protected.add(json.loads(docker("image", "inspect", reference))[0]["Id"])
    ids = sorted(set(docker("image", "ls", "--all", "--quiet", "--no-trunc").splitlines()))
    images = [json.loads(docker("image", "inspect", image_id))[0] for image_id in ids]
    records = inventory(images, protected, set(args.repository), args.keep, set(args.workdir))
    print(json.dumps({"mode": "apply" if args.apply else "plan", "keep": args.keep, "images": records}), flush=True)
    if not args.apply:
        return
    for record in records:
        if record["action"] != "remove":
            continue
        if record["id"] in container_images():
            raise RuntimeError(f"image became container-referenced; rerun the plan: {record['id']}")
        # No force: Docker independently refuses images used by a concurrent container.
        docker("image", "rm", "--no-prune", record["id"])
        print(json.dumps({"removed": record["id"]}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Image retention failed: {error}", file=sys.stderr)
        if isinstance(error, subprocess.CalledProcessError) and error.stderr:
            print(error.stderr.strip(), file=sys.stderr)
        sys.exit(1)
