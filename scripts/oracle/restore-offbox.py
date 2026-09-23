#!/usr/bin/env python3
"""Restore a checksum-verified off-box pair into disposable, networkless containers."""

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import time
from pathlib import Path

PG_IMAGE = "supabase/postgres:17.6.1.136"
MONGO_IMAGE = "mongo:7"
STAMP = re.compile(r"\d{8}T\d{6}Z")
SHA256 = re.compile(r"[a-fA-F0-9]{64}")
PG_NAME = re.compile(r"(?:postgres|supabase)-\d{8}T\d{6}Z\.dump")
MONGO_NAME = re.compile(r"(?:mongo-vnibb-market|vnibb-market)-\d{8}T\d{6}Z\.archive\.gz")


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def load_set(directory, requested_stamp=None):
    require(directory.is_dir() and not directory.is_symlink(), "off-box set must be a real directory")
    manifest_path = directory / "manifest.json"
    if not manifest_path.exists():
        candidates = list(directory.glob("BACKUP_VERIFICATION_*.json"))
        if requested_stamp:
            candidates = [path for path in candidates if path.name == f"BACKUP_VERIFICATION_{requested_stamp}.json"]
        require(len(candidates) == 1, "expected one verification manifest; use --stamp for a flat directory with multiple sets")
        manifest_path = candidates[0]
    require(manifest_path.is_file() and not manifest_path.is_symlink(), "manifest must be a regular file")
    manifest = json.loads(manifest_path.read_text())
    stamp = manifest.get("stamp", manifest.get("backup_id"))
    require(isinstance(stamp, str) and STAMP.fullmatch(stamp), "invalid backup stamp")
    require(requested_stamp is None or requested_stamp == stamp, "requested stamp differs from manifest")
    if isinstance(manifest["artifacts"], dict):
        artifacts = [{"name": name, **details} for name, details in manifest["artifacts"].items()]
        require(manifest.get("mongo", {}).get("included") is True, "manifest does not confirm Mongo inclusion")
        pg_tables = None  # TOC TABLE DATA count is not a public-table count.
        mongo_collections = None
    else:
        artifacts = manifest["artifacts"]
        pg_tables = manifest.get("verification", {}).get("postgresql_catalog", {}).get("public_base_tables")
        mongo_collections = manifest.get("source", {}).get("mongodb", {}).get("collections")
    require(len(artifacts) == 2, "backup set must contain exactly one Postgres and one Mongo artifact")
    selected = {}
    for item in artifacts:
        name = item["name"]
        require(isinstance(name, str) and name == Path(name).name and not name.startswith("."), "unsafe artifact name")
        kind = "postgres" if PG_NAME.fullmatch(name) else "mongo" if MONGO_NAME.fullmatch(name) else None
        require(kind is not None and f"-{stamp}." in name and kind not in selected, "unexpected/mismatched artifact")
        path = directory / name
        require(path.is_file() and not path.is_symlink(), f"missing or linked artifact: {name}")
        size = item.get("bytes", item.get("size_bytes"))
        digest = item.get("sha256")
        require(isinstance(size, int) and size > 0 and SHA256.fullmatch(str(digest)), f"invalid manifest entry: {name}")
        require(path.stat().st_size == size, f"size mismatch: {name}")
        with path.open("rb") as artifact:
            actual = hashlib.file_digest(artifact, "sha256").hexdigest()
        require(actual.lower() == digest.lower(), f"SHA256 mismatch: {name}")
        print(f"SHA256 OK: {name} ({size} bytes)", flush=True)
        selected[kind] = name
    require(len(selected) == 2, "incomplete Postgres/Mongo pair")
    return stamp, selected, pg_tables, mongo_collections


def run(command, *, capture=False, timeout=None, environment=None):
    try:
        return subprocess.run(command, check=True, text=True, env=environment,
                              stdout=subprocess.PIPE if capture else None, timeout=timeout).stdout
    except subprocess.CalledProcessError as exc:
        # Never expose the command because Docker bootstrap credentials may be in its child environment.
        raise RuntimeError(f"command failed with exit status {exc.returncode}") from None
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"command timed out after {timeout}s") from None


def remove_containers(docker, names):
    failures = []
    for name in reversed(names):
        removal = subprocess.run(docker + ["rm", "-f", name], capture_output=True, text=True)
        remaining = subprocess.run(docker + ["ps", "-a", "--filter", f"name=^/{name}$",
                                           "--format", "{{.Names}}"], capture_output=True, text=True)
        if remaining.returncode or remaining.stdout.strip() or (removal.returncode and remaining.stderr):
            failures.append(name)
    require(not failures, "could not confirm removal of recovery containers: " + ", ".join(failures))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("off_box_set", type=Path, help="directory containing a matched manifest and both artifacts")
    parser.add_argument("--stamp", help="select a historical flat-directory set with multiple manifests")
    parser.add_argument("--confirm-isolated", action="store_true", help="acknowledge this is an off-box copy, NOT a source path")
    args = parser.parse_args()
    require(args.confirm_isolated, "pass --confirm-isolated after checking the path is an off-box copy")
    source = args.off_box_set.absolute()
    require(not source.is_symlink(), "off-box set cannot be a symlink")
    started = time.monotonic()
    require(args.stamp is None or STAMP.fullmatch(args.stamp), "invalid requested stamp")
    stamp, files, expected_tables, expected_collections = load_set(source, args.stamp)
    docker = ["docker"]
    require(shutil.which("docker"), "Docker CLI unavailable")
    if subprocess.run(docker + ["info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        require(shutil.which("sudo") and subprocess.run(["sudo", "-n", "docker", "info"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0,
                "Docker daemon unavailable (including sudo -n docker); arrange access without interactive sudo")
        docker = ["sudo", "-n", "docker"]
    for image in (PG_IMAGE, MONGO_IMAGE):
        run(docker + ["image", "inspect", image], capture=True)
    token = secrets.token_hex(8)
    pg = f"vnibb-recovery-pg-{token}"
    mongo = f"vnibb-recovery-mongo-{token}"
    mounted = f"type=bind,src={source},dst=/recovery,readonly"
    created = [pg, mongo]  # Include both planned names even if a run fails partway through.

    def execute(*args, capture=False, timeout=None, environment=None):
        command = docker
        if environment is not None and docker[0] == "sudo":
            command = ["sudo", "-n", "--preserve-env=POSTGRES_PASSWORD", "docker"]
        return run(command + list(args), capture=capture, timeout=timeout, environment=environment)

    try:
        postgres_password = secrets.token_urlsafe(32)
        # Pass the value through Docker's child environment, never through argv or logged argv.
        pg_environment = os.environ.copy()
        pg_environment["POSTGRES_PASSWORD"] = postgres_password
        execute("run", "-d", "--rm", "--network", "none", "--name", pg,
                "--mount", mounted, "-e", "POSTGRES_PASSWORD", PG_IMAGE,
                capture=True, environment=pg_environment)
        for _ in range(120):
            if subprocess.run(docker + ["exec", pg, "pg_isready", "-U", "supabase_admin", "-d", "postgres"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("fresh PostgreSQL failed readiness in 120s")
        execute("exec", pg, "createdb", "-U", "supabase_admin", "-T", "template0", "vnibb_recovery")
        print("Restoring fresh PostgreSQL database (strict exit status)...", flush=True)
        execute("exec", pg, "pg_restore", "--exit-on-error", "--no-owner", "--no-privileges",
                "-U", "supabase_admin", "-d", "vnibb_recovery", "/recovery/" + files["postgres"])
        sql = ("SELECT (SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'), "
               "(SELECT count(*) FROM public.stocks), (SELECT count(*) FROM public.stock_prices)")
        result = execute("exec", pg, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin",
                         "-d", "vnibb_recovery", "-tAc", sql, capture=True).strip()
        tables, stocks, prices = (int(v) for v in result.split("|"))
        require(tables >= 10 and stocks > 0 and prices > 0,
                f"Postgres data assertions failed: tables={tables}, stocks={stocks}, stock_prices={prices}")
        if expected_tables is not None:
            require(tables == expected_tables, f"Postgres table count mismatch: {tables} != {expected_tables}")
        print(f"PostgreSQL OK: {tables} public tables, {stocks} stocks, {prices} stock_prices", flush=True)
        execute("run", "-d", "--rm", "--network", "none", "--name", mongo,
                "--mount", mounted, MONGO_IMAGE, capture=True)
        for _ in range(120):
            if subprocess.run(docker + ["exec", mongo, "mongosh", "--quiet", "--eval",
                                        "db.adminCommand({ping:1}).ok"],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0:
                break
            time.sleep(1)
        else:
            raise RuntimeError("fresh MongoDB failed readiness in 120s")
        print("Restoring fresh MongoDB database (strict exit status)...", flush=True)
        execute("exec", mongo, "mongorestore", "--archive=/recovery/" + files["mongo"],
                "--gzip", "--stopOnError", "--nsInclude=vnibb-market.*")
        js = ("const d=db.getSiblingDB('vnibb-market');"
              "const names=d.getCollectionNames();"
              "const counts=names.map(n=>({name:n,count:d.getCollection(n).estimatedDocumentCount()}));"
              "const populated=counts.filter(c=>c.count>0);"
              "const largest=counts.reduce((a,b)=>b.count>a.count?b:a,{name:'',count:0});"
              "const sample=largest.name && d.getCollection(largest.name).findOne()!=null;"
              "const eod=d.getCollection('market_prices_eod').estimatedDocumentCount();"
              "print(JSON.stringify({collections:names.length,populated:populated.length,largest,sample,eod}));")
        mongo_result = json.loads(execute("exec", mongo, "mongosh", "--quiet", "--eval", js, capture=True).strip())
        require(mongo_result["collections"] >= 2 and mongo_result["populated"] >= 2
                and mongo_result["largest"]["count"] > 0 and mongo_result["sample"] and mongo_result["eod"] > 0,
                f"Mongo data assertions failed: {mongo_result}")
        if expected_collections is not None:
            require(mongo_result["collections"] == expected_collections,
                    f"Mongo collection count mismatch: {mongo_result['collections']} != {expected_collections}")
        print(f"MongoDB OK: {mongo_result['collections']} collections, "
              f"{mongo_result['populated']} populated, largest={mongo_result['largest']['name']} "
              f"({mongo_result['largest']['count']} documents), sampled document present", flush=True)
        restore_seconds = time.monotonic() - started
    finally:
        remove_containers(docker, created)
    print(f"RECOVERY OK: set={stamp} RTO_seconds={restore_seconds:.1f} "
          "(local verification+startup+restore+assertions; excludes off-box transfer/cutover)", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.CalledProcessError,
            subprocess.TimeoutExpired) as exc:
        print(f"RECOVERY FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
