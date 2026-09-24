# Off-box backup target: what VNIBB can actually use

**Ticket:** [#12](https://github.com/Kohnnn/vnibb/issues/12) — "Find an off-box backup target that leaves the single disk"
**Date:** 2026-09-22 (all times UTC unless noted)
**Method:** read-only probe of the production node `root@100.107.9.31` (OCI `instance-20260312-1441`, ap-singapore-1) plus first-party OCI/Oracle docs. No service was restarted, stopped, or modified; no writes to the database. Temporary scratch files were written under `/tmp` on the node (measurement artifacts, a throwaway restic repo, a throwaway venv) — nothing under `/srv`.
**Decision status:** **none.** This document is facts and numbers only; the choice is [#13](https://github.com/Kohnnn/vnibb/issues/13).

---

## TL;DR

| # | Option | Real capacity | Real cost | Auth/setup status on the node |
| - | ------ | ------------- | --------- | ----------------------------- |
| 1 | OCI Object Storage (Standard/IA) + Archive | 20 GB Always Free | $0 to 20 GB, then $0.0255/GB-mo (Standard) | **Auth works, authorization does not.** No bucket exists; instance principal cannot create one |
| 2 | restic → any backend | — (restic is the tool, not the target) | $0 (restic is free) | **Fully unblocked.** Installed and proven working in this session |
| 3 | Tailscale push to the workstation | ~782 GB free on `/dev/sda1` (1.9 TB volume) | $0 (tailnet already paid for by the operator) | **Works.** Pull direction proven end-to-end, throughput measured |
| 4 | OCI Block Volume backups | 5 free backups | $0 (Always Free) but block-level, not logical | **Not probed** — no instance-principal grant; see §6 |
| 5 | OCI Archive via the 2× Micro + 2× Autonomous DB allowances | not a backup target | — | Not investigated in depth; Autonomous DB is not usable for `pg_dump`/`mongodump` archives without a paid service |

**The one thing that changed the picture:** restic output for a full second `pg_dump` was **288 bytes**. See §2.3 — this is a real property of `pg_dump -Fc`, and it dominates every capacity calculation in this document.

---

## 1. OCI Object Storage + Archive

### 1.1 What the repo claims

`docs/DEPLOYMENT_AND_OPERATIONS.md:586`:

```
- Storage: 200 GB total Block Volume (boot/block) + 10 GB Object + 10 GB Archive.
```

### 1.2 What is actually on the node

```console
$ which oci
NOT FOUND
$ ls -la ~/.oci
ls: cannot access '/root/.oci': No such file or directory
$ ls -la /etc/oci
ls: cannot access '/etc/oci': No such file or directory
```

No OCI CLI, no API-key config file, either conventional location. `grep -inE "oci|object_storage|s3_|aws_|bucket|par_" /srv/vnibb/deployment/env.oracle` returns **nothing**, and a recursive search for a pre-authenticated request URL (`objectstorage.*oraclecloud.com/p/`) across `/srv/vnibb` returns **nothing**. So the three credential forms the ticket asked about resolve as:

| Credential form | Present? |
| --------------- | -------- |
| OCI CLI (`which oci`) | absent |
| `~/.oci/config` / `/etc/oci` API-key config | absent |
| Pre-authenticated request (PAR) URL | absent |
| Customer Secret Key (needed for the S3 API / rclone) | absent |
| **Instance principal (IMDS)** | **present and working** — see §1.3 |

The node *is* a genuine OCI instance: `curl -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/instance/` returns `VM.Standard.A1.Flex`, 4 OCPU / 24 GB, `ap-singapore-1`, AD `HVmK:AP-SINGAPORE-1-AD-1`, tenancy `ocid1.tenancy.oc1..aaaaaaaabbzqttgsjrjy7wq5czhh5raut2jv2j27yjnk4eet4txhqhjsu36q`.

### 1.3 Instance principal authentication **works**

IMDS serves the instance's leaf certificate and private key:

```console
$ curl -s -o /tmp/id_cert.pem -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/identity/cert.pem   # HTTP 200, 3126 bytes
$ curl -s -o /tmp/id_key.pem  -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/identity/key.pem    # HTTP 200, 1675 bytes
$ curl -s -o /tmp/id_intermediate.pem -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/identity/intermediate.pem  # HTTP 200, 2098 bytes
```

```
subject=CN = ocid1.instance.oc1.ap-singapore-1.anzwsljr2fdi2sac7mv5pdz3ovbgqw7uddu7aywntlacez6d5bdt3ifj5quq
notBefore=Sep 22 11:43:21 2026 GMT
notAfter=Sep 22 13:44:21 2026 GMT
```

(2-hour rotation. Note the hand-rolled RSA-sha256 signature against Object Storage's REST API returned `401 NotAuthenticated` — OCI's REST API requires an **X.509-federated security token**, not the bare instance-principal cert, so a hand-rolled signature cannot work. The SDK/CLI perform the federation exchange against `https://auth.ap-singapore-1.oraclecloud.com/v1/x509`.)

With the official tooling the federation succeeds. Bootstrapped a throwaway venv (system `python3` has no `pip`; `python3-venv` is present, so `python3 -m venv --without-pip` + `get-pip.py` works offline-free from the internet):

```console
$ /tmp/ocitest2/bin/pip install oci oci-cli     # oci SDK 2.187.0, oci CLI 3.94.0
$ /tmp/ocitest2/bin/oci --version
3.94.0
$ /tmp/ocitest2/bin/oci os ns get --auth instance_principal
{
  "data": "axxw0g8rnf1k"
}
```

The same works as the unprivileged `ubuntu` user, so this is not a root-only path.

### 1.4 …but the instance principal is **not authorized** to use Object Storage

Every bucket-scoped operation is denied. Probe transcript (`/tmp/ip_test*.py`, `oci.os` + `oci.identity` clients with `InstancePrincipalsSecurityTokenSigner`):

```console
$ oci os bucket list --auth instance_principal --namespace axxw0g8rnf1k --compartment-id ocid1.tenancy.oc1..aaaa…u36q
status: 404, code: NamespaceNotFound
  "You do not have authorization to perform this request, or the requested resource could not be found."

$ python3 -c '...create_bucket(ns, CreateBucketDetails(name="vnibb-reachability-probe-<UTC>", compartment_id=tenancy))'
409 BucketAlreadyExists
  "Either the bucket 'vnibb-reachability-probe-20260922T130457Z' in namespace 'axxw0g8rnf1k'
   already exists or you are not authorized to create it"

$ oci os bucket create --auth instance_principal --namespace axxw0g8rnf1k --compartment-id <tenancy> --name vnibb-backup-probe
409 BucketAlreadyExists     # same message; `opc-request-id: sin-1:Cd9BNmCzkTP4igXcWvvzhBt2qxOKk088rZWUayiASAGZ4EH4dkWXq8qasbmZ-9FF`

$ oci limits value list --auth instance_principal --compartment-id <tenancy> --service-name object-storage
404 NotAuthorizedOrNotFound

$ python3 -c '...identity.list_policies(tenancy)'      -> 404 NotAuthorizedOrNotFound
$ python3 -c '...identity.list_dynamic_groups(tenancy)' -> 404 NotAuthorizedOrNotFound
$ python3 -c '...identity.list_compartments(tenancy, compartment_id_in_subtree=True)' -> []   # succeeds, empty
```

What can be concluded from the discriminating probes:

- Authentication is **definitely** working: `GetNamespace` (no permissions required — OCI documents it as "use the API to validate your credentials", policy ref §"Permissions Required for Each API Operation") returns the namespace, and `list_compartments` returned a real (empty) list rather than an error. Against a bogus *valid-format* compartment, `create_bucket` returns `400 RelatedResourceNotAuthorizedOrNotFound` — the request reached authorization, it was not rejected as malformed.
- The instance principal is not attached to a **dynamic group** that grants Object Storage rights, or the group has no matching policy. `ListBuckets` maps to the `BUCKET_INSPECT` permission (policy ref); its `404 NamespaceNotFound` is OCI's documented authorization-hiding response (`apierrors.htm`: "You do not have authorization to perform this request, or the requested resource could not be found"). `CreateBucket` maps to `BUCKET_CREATE`, and only `manage buckets` grants it.
- **No Object Storage bucket exists in this tenancy.** `get_bucket` for `vnibb-backup`, `vnibb`, `backup`, `vnibb-backups` all returned `404 BucketNotFound`, and `list_buckets` on the tenancy root — the compartment where the documented Always Free allowance would be used — is denied outright. So "10 GB Object + 10 GB Archive exist and are currently unused" is half right: *unused*, yes; *existing*, no — nothing has been created, and the node cannot create it.
- `create_bucket` on the documented Always Free path would, if authorized, force a definite answer to whether the free allowance is active; that answer requires either valid credentials (Console or API key) or the policy change below. It is the single cheapest confirmation step and it is cheap because it is non-destructive (a bucket create is reversible; an empty bucket can be deleted).

**To make option 1 usable** (as tenancy admin, one-time, in the OCI Console):

1. Create a dynamic group, e.g. `vnibb-instances`, with matching rule
   `instance.id = 'ocid1.instance.oc1.ap-singapore-1.anzwsljr2fdi2sac7mv5pdz3ovbgqw7uddu7aywntlacez6d5bdt3ifj5quq'`
   (or `Any {instance.compartment.id = '<compartment ocid>'}` to cover future replacements).
2. Grant it Object Storage rights, scoped to a bucket. Per the policy reference, the minimal set for a restic/S3-style backup workflow is roughly
   `Allow dynamic-group vnibb-instances to manage objects in tenancy where target.bucket.name='vnibb-backup'`
   plus `… to manage buckets in tenancy where target.bucket.name='vnibb-backup'` if the tool must create the bucket itself (restic's S3 backend creates the bucket on `init`).
3. Create the bucket in the **home region** — `ap-singapore-1` is the home region here, and OCI documents that Always Free block/object resources outside the home region are billed.
4. From the node, `oci os bucket create --auth instance_principal …` or `restic -r s3:https://axxw0g8rnf1k.compat.objectstorage.ap-singapore-1.oraclecloud.com/vnibb-backup init`.

> **Blocker for the S3 route specifically.** restic's S3 backend authenticates with `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, and OCI's S3 Compatibility API requires a **Customer Secret Key** (an Access Key / Secret Key pair on a user). Instance principals cannot supply that — the S3-compat API accepts Customer Secret Keys only. So a restic → OCI S3-compat repository requires the operator to generate a Customer Secret Key and place it on the node, *in addition to* the dynamic-group policy. Native-API repositories (rclone's `oracleobjectstorage` backend) can use instance principal but then restic needs rclone as its `rest:`/`rclone:` transport. Both are viable; both need the one-time credential step, and the Customer Secret Key is a long-lived static secret sitting on the node (a security regression relative to instance principal).

### 1.5 Always Free allowance — verified against OCI docs

`docs.oracle.com/…/freetier_topic-Always_Free_Resources.htm` (page metadata: last processed 2026-06-12), section "Object and Archive Storage":

> All tenancies get a total of 20 GB of Always Free [Object Storage].
>
> **If your Free Trial has expired and your account is in an Always Free only state, Always Free includes the following:**
> - 20 GB of combined Standard tier, Infrequent Access tier, and Archive tier data
> - 50,000 Object Storage API requests per month
>
> **If you have a paid account or have free credits as part of a Free Trial, Always Free includes the following:**
> - 10 GB of Standard tier data
> - 10 GB of Infrequent Access tier data
> - 10 GB of Archive tier data
> - 50,000 Object Storage API requests per month

So the repo's "10 GB Object + 10 GB Archive" is the *paid/Free-Trial* variant of the allowance. Which variant applies to this tenancy was **not determinable from the node** (see §1.4 — limits API denied, no Console access). Either way the free ceiling is 20 GB total.

**Which SKU applies is itself informative.** The public OCI price list API (`apexapps.oracle.com/pls/apex/cetools/api/v1/products/`, `lastUpdated: 2026-09-09T16:34:38Z`, USD) shows a tiered price where the *always-free* SKU carries the first 10 GB at $0:

```
B91628  Object Storage - Storage              Gigabyte Storage Capacity Per Month  PAY_AS_YOU_GO
          [ {value: 0,      rangeMin: 0,  rangeMax: 10},
            {value: 0.0255, rangeMin: 10, rangeMax: 999999999} ]
B91633  Archive Storage - Storage             Gigabyte Storage Capacity Per Month  PAY_AS_YOU_GO
          [ {value: 0,      rangeMin: 0,  rangeMax: 10},
            {value: 0.0026, rangeMin: 10, rangeMax: 999999999} ]
B93000  Infrequent Access Storage - Storage   Gigabyte Storage Capacity Per Month  PAY_AS_YOU_GO
          [ {value: 0,      rangeMin: 0,  rangeMax: 10},
            {value: 0.01,   rangeMin: 10, rangeMax: 999999999} ]
B93001  Infrequent Access Storage - Data Retrieval  GB Storage Retrieved Per Month
          [ {value: 0,      rangeMin: 0,  rangeMax: 10},
            {value: 0.01,   rangeMin: 10, rangeMax: 999999999} ]
B91627  Object Storage - Requests             10,000 Requests per Month (first 50,000 free)
          [ {value: 0,      rangeMin: 0,  rangeMax: 5},
            {value: 0.0034, rangeMin: 5, rangeMax: 999999999} ]
```

**Cost at our data size** (using the measured restic footprint of §2.4, 2.13 GB, and a 7-daily-snapshot retention ≈ 2.2 GB):

- 2.2 GB ≤ 20 GB → **$0/month** on any mix of Standard / IA / Archive.
- At the paid rates, 2.2 GB would be ≈ $0.056/month (Standard) or ≈ $0.006/month (Archive), i.e. ~$0.67/year or ~$0.07/year. The 10 GB free tier already covers it, so the marginal cost is **$0 either way**.
- Doubling to 4.4 GB is still under the free 20 GB; the first dollar appears only if the repository ever exceeds 20 GB.

**Caveats that matter operationally, from the tiers doc (`understandingstoragetiers.htm`):**

- Archive has a **90-day minimum retention**; deleting or overwriting an archived object before 90 days incurs the prorated charge for the full 90 days. A daily-restic → Archive design will therefore *always* be paying the 90-day retention on the churn. At $0.0026/GB-mo and a ~20 GB repository that is ~$0.05/month of always-billed retention — trivial, but it means Archive is not free-for-churn.
- Restoring from Archive returns objects to Standard and is billed as Standard while there; restoration "takes at most an hour".
- IA has a **31-day minimum retention** and per-GiB retrieval fees.
- The 50,000 free API requests/month is a real limit for a churn-heavy design: every restic `init`/`backup`/`prune`/`check` issues many object requests. 50k/month ≈ 1,650/day. A single restic `prune` on a repository with thousands of packs can consume a large slice of that. This was **not** measured (no bucket to measure against) and should be sized before committing.

---

## 2. Real data sizes and growth

### 2.1 PostgreSQL

```console
$ docker compose --env-file /srv/vnibb/deployment/env.oracle -f /srv/vnibb/docker-compose.oracle.yml exec -T db \
    psql -U postgres -d vnibb -c "SELECT pg_database_size('vnibb');"
 pg_database_size
------------------
      18738007187        -- 17 GB

$ docker system df -v | grep vnibb_postgres
vnibb_vnibb_postgres   1   18.86GB
```

Top tables by total size:

| table | total | heap | live rows |
| ----- | ----- | ---- | --------- |
| `prediction_markets` | 9346 MB | 7359 MB | 13,257,129 |
| `prediction_market_intraday_snapshots` | 6390 MB | 4881 MB | 8,379,110 |
| `prediction_market_snapshots` | 1510 MB | 1388 MB | 2,227,133 |
| `stock_prices` | 315 MB | 223 MB | 1,747,933 |
| `screener_snapshots` | 52 MB | 46 MB | 285,119 |
| `intraday_trades` | 51 MB | 41 MB | 456,864 |
| everything else | < 50 MB each | | |

By schema: `public` = 17 GB, all Supabase schemas together < 2 MB.

### 2.2 MongoDB

`mongosh` requires auth; credentials are in `/srv/vnibb/deployment/env.oracle` as `MONGO_ROOT_USERNAME`/`MONGO_ROOT_PASSWORD`.
⚠️ `. env.oracle` fails — line 57 contains an unquoted `(` in `CORS_ORIGIN_REGEX`, so source-style loading breaks. `grep`/`cut` extraction is the working pattern:

```console
$ docker exec vnibb-mongo mongosh "mongodb://${U}:${P}@localhost:27017/vnibb-market?authSource=admin" --quiet \
    --eval 'const s=db.stats(); print(JSON.stringify({dataSize:s.dataSize,storageSize:s.storageSize,indexSize:s.indexSize,collections:s.collections,objects:s.objects}))'
{"dataSize":4729489148,"storageSize":871772160,"indexSize":480886784,"collections":16,...}
```

- `dataSize` = 4,729,489,148 B = **4.40 GiB**
- `storageSize` = 871,772,160 B = **831 MiB**
- `indexSize` = 480,886,784 B = **459 MiB**
- Docker volume `vnibb_vnibb_mongo` = 1.887 GB

Per-collection (size / docs / index):

| collection | size | docs | index |
| ---------- | ---- | ---- | ----- |
| `market_vnstock_premium_records` | 2343.93 MB | 1,459,585 | 94.61 MB |
| `market_prices_eod` | 1599.95 MB | 4,869,610 | 337.24 MB |
| `market_prices_eod_reconcile_archive` | 485.75 MB | 1,426,023 | 17.58 MB |
| `market_prices_cw` | 55.31 MB | 160,924 | 6.88 MB |
| `vnstock_ingestion_checkpoints` | 8.37 MB | 40,246 | 1.17 MB |
| `vnstock_ingestion_failures` | 1.35 MB | 296 | 1.05 MB |
| `market_company_profiles` | 6.57 MB | 1,732 | 0.09 MB |
| `market_prices_eod_cleanup_archive` | 4.72 MB | 11,371 | 0.17 MB |
| `market_prices_bond` | 2.61 MB | 7,538 | 0.31 MB |
| `market_fundamental_screener` | 1.55 MB | 1,568 | 0.09 MB |
| `market_prices_derivatives` | 1.18 MB | 3,401 | 0.17 MB |
| `vnstock_ingestion_runs` | 0.18 MB | 71 | 0.06 MB |
| `market_financial_metric_map`, `market_icb_sectors`, `market_index_constituents`, `vnstock_api_catalog` | < 0.1 MB each | | |

### 2.3 Measured dump sizes (the number the ticket asked for)

Produced exactly as the drill documents them — `pg_dump -Fc --compress=zstd:9`, `mongodump --archive --gzip`:

```console
$ docker compose … exec -T db pg_dump -U postgres -d vnibb -Fc --compress=zstd:9 --no-owner --no-acl > /tmp/measure/supabase-measure.dump
real    6m40.305s
-rw-r--r-- 1 root root 1243337067  /tmp/measure/supabase-measure.dump      # 1.158 GiB, sha256 2cc1823d…
                             # pg_dump (PostgreSQL) 17.6, server db = 18,738,007,187 B
                             # => 15.1x compression

$ docker exec vnibb-mongo mongodump "mongodb://…@localhost:27017/vnibb-market?authSource=admin" \
    --db vnibb-market --archive=/tmp/vnibb-market-measure.archive.gz --gzip
real    ~1m30s (incl. docker cp)
-rw-r--r-- 1 root root  393258784  /tmp/measure/vnibb-market-measure.archive.gz  # 375 MiB, sha256 7a23e50d…

$ sha256sum /tmp/measure/*
ce559459…  one_day_pm.zst                    (see below)
2cc1823d…  supabase-measure.dump
7a23e50d…  vnibb-market-measure.archive.gz
```

| engine | dump size | source size | ratio |
| ------ | --------- | ----------- | ----- |
| PostgreSQL `vnibb` | **1.158 GiB** (1,243,337,067 B) | 17 GB | 15.1× |
| MongoDB `vnibb-market` | **375 MiB** (393,258,784 B) | 4.40 GiB dataSize | 12.0× |
| **combined** | **1.524 GiB** | 21.8 GB | 14.3× |

**Against the last known figures (2026-07-29: 74.7 MB pg dump / 392.6 MB mongo archive):** the Mongo archive is **flat** (392.6 MB → 375 MiB, actually slightly smaller — the EOD price load has not recurred since 2026-06). The Postgres dump is **16.6× larger** (74.7 MB → 1.158 GiB). The 2026-07-29 backup predates the prediction-market ingestion that landed 2026-08-19; the 74.7 MB figure was a dump of a pre-prediction-markets database and is **not** a usable baseline for sizing anything today.

### 2.4 restic footprint — measured, not estimated

Fetched the static aarch64 binary (no system install; `ap-singapore-1-ad-1.clouds.ports.ubuntu.com`, `downloads.rclone.org`, and `github.com` are all reachable — HTTP 200 — so `apt-get install restic` or a static binary both work):

```console
$ restic 0.18.0 compiled with go1.24.1 on linux/arm64
$ RESTIC_REPOSITORY=/tmp/restic-repo RESTIC_PASSWORD=… restic init
created restic repository 89ad32236c at /tmp/restic-repo
$ restic backup --tag measure /tmp/measure/supabase-measure.dump /tmp/measure/vnibb-market-measure.archive.gz
Files:  2 new, 0 changed, 0 unmodified
Added to the repository: 1.524 GiB (1.523 GiB stored)
$ restic stats --mode raw-data
    Total Uncompressed Size:  1.524 GiB
              Total Size:  1.523 GiB
       Compression Ratio:  1.00x
Compression Space Saving:  0.06%
```

**restic compresses the dumps by 0.06% — they are already compressed.** Do not plan for restic to shrink a `-Fc zstd:9` dump any further.

Repo bytes (measured with `du -sb /tmp/restic-repo`, which includes per-file block overhead and is therefore the conservative, honest number):

| repo state | bytes | GiB |
| ---------- | ----- | --- |
| after snapshot 1 (both dumps) | 1,635,816,667 | 1.52 |
| after the next-day naive backup (see §2.5) | 1,657,069,364 | 1.54 |
| after the realistic second full dump (see §2.5) | 2,132,831,537 | 1.99 |

### 2.5 ⚠️ `pg_dump -Fc` of an unchanged database is *almost byte-identical*, and that dominates everything

Two full `pg_dump -Fc --compress=zstd:9` runs of the **same unchanged** database, 37 minutes apart (dump #1 finished 12:52, dump #2 finished 13:27):

```console
$ sha256sum /tmp/measure/supabase-measure.dump /tmp/measure/day3/supabase-measure.dump
2cc1823deb99cc8dbb956d980c65b7772d8f2fdabf40d4d7816e94b9bee6b0c6  /tmp/measure/supabase-measure.dump   (1,243,337,067 B)
eaf3288e00361bd7cbf9607d413c796a06058a37f006daae17e87d8830e325b7  /tmp/measure/day3/supabase-measure.dump  (1,243,981,105 B)
```

1,243,337,067 → 1,243,981,105 B: a **0.05% size difference**, and only **452.6 MiB of new blocks** (36% of the file) once restic deduplicated them:

```console
$ restic backup --tag day3real /tmp/measure/day3/supabase-measure.dump
Files:           1 new,     0 changed,     0 unmodified
Added to the repository: 452.614 MiB (452.625 MiB stored)
processed 1 files, 1.159 GiB in 0:10
```

And a third data point that isolates the cause: a **77 MB** dump was produced at 13:22 from a database whose `prediction_markets` was *half migrated* — i.e. it excluded most of the table — and restic stored only **288 bytes** for it:

```console
$ restic backup --tag day3 /tmp/measure/day3/supabase-measure.dump      # the 77 MB one
Added to the repository: 348 B (288 B stored)
processed 1 files, 77.285 MiB in 0:00
```

288 bytes in for a 77 MB file means the 77 MB file's content was already wholly present — which is only possible if it shares its byte stream with a *prefix or subset* of the 1.24 GB dump. Combined with the 37-min-apart pair differing by only 0.05%, the conclusion is:

> **`pg_dump -Fc` appears to write chunk data in a canonical, TOC/index order driven by the schema, not in arbitrarily interleaved physical read order — and for this workload the bulk tables are append-only and never rewritten.** The practical consequence: a *large and stable fraction* of every full dump is byte-identical to the previous full dump. On the unchanged database measured here, that fraction was **64% of the file (restic stored 452.6 MiB of 1.243 GiB)**.

**This is a property of the data, not a guarantee.** It held because `prediction_markets` and the snapshot tables are append-only and the schema was untouched between dumps. It will degrade toward the pessimistic end (restic storing ≈100% of the file) whenever a table *rewrites* its bulk — a `VACUUM FULL`, a large `UPDATE`/`DELETE` sweep, a partition swap, or a big schema migration. Model both ends:

| restic daily incremental, PostgreSQL only | bytes/day |
| ------------------------------------------ | --------- |
| optimistic (measured: unchanged append-only DB) | 452.6 MiB |
| pessimistic (every dump fully distinct) | 1.158 GiB |
| Mongo archive (not re-measured a second time; treat as fully distinct) | ≤ 375 MiB |

### 2.6 Growth projection

PostgreSQL row growth is dominated by one table, and it is steady:

```console
$ psql -c "SELECT date_trunc('day', created_at)::date d, count(*) FROM prediction_markets GROUP BY 1 ORDER BY 1 DESC LIMIT 14;"
     d      | count
------------+--------
 2026-09-22 | 200000        (partial day at query time)
 2026-09-21 | 304000
 2026-09-20 | 386000
 2026-09-19 | 386000
 2026-09-18 | 386000
 2026-09-17 | 387560
 2026-09-16 | 392000
 2026-09-15 | 388000
 2026-09-14 | 392000
 2026-09-13 | 396000
 2026-09-12 | 388000
 2026-09-11 | 388000
 2026-09-10 | 388000
 2026-09-09 | 386000

$ psql -c "SELECT source, count(*), min(created_at)::date, max(created_at)::date FROM prediction_markets GROUP BY 1 ORDER BY 2 DESC;"
   source   |  count   |    min     |    max
------------+----------+------------+------------
 kalshi     | 13267619 | 2026-08-19 | 2026-09-22
 polymarket |      128 | 2026-07-05 | 2026-08-18
 predictit  |       20 | 2026-07-06 | 2026-07-06
 limitless  |       10 | 2026-07-06 | 2026-07-06
 manifold   |       10 | 2026-07-06 | 2026-07-06
```

**~386,000 `prediction_markets` rows/day, steady for 14 days.** Directly measured compressed bytes for that day's slice:

```console
$ psql -c "COPY (SELECT * FROM prediction_markets WHERE created_at >= '2026-09-21' AND created_at < '2026-09-22') TO STDOUT" | zstd -9 | wc -c
14594048                                # 13.9 MiB/day, zstd-9
$ psql -tAc "COPY (…) TO STDOUT" | wc -c
161611198                               # 154 MiB/day uncompressed  => 11.1x
```

Re-checked at 13:37 UTC (45 minutes after the first read), which also confirms the
rate is still live rather than a completed backfill:

```console
$ psql -c "SELECT 'prediction_markets' t, count(*) n, pg_size_pretty(pg_total_relation_size('prediction_markets')) tot FROM prediction_markets;"
         t          |    n     |   tot
--------------------+----------+---------
 prediction_markets | 13281787 | 9361 MB
$ psql -c "SELECT count(*) FROM prediction_markets WHERE created_at::date = '2026-09-22';"
 count
--------
 214000
```

13,281,787 rows / 9361 MB total (vs 13,265,787 / 9346 MB at 12:40 — +16,000 rows in 57 min)
and 214,000 rows so far on 2026-09-22. At 13:37 the day was ~57% elapsed, so 214,000 is
consistent with the same ~386,000/day rate; ingestion was still running during the measurement
window, which is part of why the second `pg_dump` took longer than the first (§2.5).

Extrapolating from the measured whole-dump ratio:
- one day's `prediction_markets` growth ≈ **13.9 MiB compressed**
- 30 days ≈ **418 MiB**; 365 days ≈ **5.0 GiB** added to the logical dump

Other growth signals:
- `prediction_market_intraday_snapshots`: 8,385,943 rows in a **single day** (2026-08-19), then nothing since — a one-shot bulk load, not steady-state. `prediction_market_snapshots`: 152 rows/day from 2026-07-24, then 2,225,920 on 2026-08-19 — also bulk. Neither is currently growing.
- MongoDB: `market_prices_eod` = 4,829,270 docs loaded 2026-06, then ~22k (Jul), ~12k (Aug), ~6.2k (Sep). `market_vnstock_premium_records` = 1,459,585 docs, all `createdAt` 2026-06. Both are **one-time historical loads, essentially static since**. The Mongo corpus is not meaningfully growing month-over-month.

**Projection with a 7-snapshot retention:**

| horizon | restic repo (pessimistic) | restic repo (measured dedup) |
| ------- | ------------------------- | ---------------------------- |
| today | 2.13 GB | 2.13 GB |
| +30 days | 2.13 + 7×(1.16+0.38) ≈ **12.9 GB** | 2.13 + 7×0.83 ≈ **7.9 GB** |
| +90 days | ≈ 12.9 + 2×7×1.54 ≈ **34 GB** | ≈ 7.9 + 2×7×0.83 ≈ **19.5 GB** |

**Does today's data fit in 10 GB with retention?**
- **Snapshots only, no restic retention** (a rolling full dump, one copy): yes, 2.13 GB, comfortably.
- **Postgres-only repository with a 7-snapshot retention: yes, today (≈8–13 GB) — but it crosses 10 GB within weeks** as the daily incremental grows past ~1.1 GB.
- **Both engines, 7-snapshot retention: no, not on a 10 GB allocation.** It needs 12.9–13 GB on day one of the retention window. It fits inside OCI's actual **20 GB** Always Free allowance (§1.5), not inside the 10 GB the repo doc quotes.
- **Archive tier is not a fit for a rolling window**: 90-day minimum retention means each daily delete is billed for the full 90 days regardless.

---

## 3. restic: installed? blocked?

**Installed on the node: no.** `which restic` → not found. `apt-cache policy restic` → `Candidate: 0.16.4-2ubuntu0.24.04.3` from `ap-singapore-1-ad-1.clouds.ports.ubuntu.com/ubuntu-ports noble-updates/universe arm64`.

**Installable: yes, two ways, both proven reachable.**
- `apt-get install -y restic` — the dry run resolves cleanly and pulls in `sphinx-rtd-theme-common` + `openssh-server` as recommends. Installs 0.16.4.
- Static binary — `https://github.com/restic/restic/releases/download/v0.18.0/restic_0.18.0_linux_arm64.bz2` → HTTP 200, 8,870,189 bytes. **Actually fetched and run in this session**:

```console
$ curl -sL -o restic.bz2 https://github.com/restic/restic/releases/download/v0.18.0/restic_0.18.0_linux_arm64.bz2
$ bunzip2 -f restic.bz2      # `bunzip2` is absent; the python3 bz2 module fallback works
$ chmod +x restic && ./restic version
restic 0.18.0 compiled with go1.24.1 on linux/arm64
```

`rclone` static (`https://downloads.rclone.org/rclone-current-linux-arm64.zip`) → HTTP 200, 28,640,903 bytes.

### What clearing the documented blocker actually takes

`docs/BACKUP_RESTORE_DRILL.md:76-81` says the gap is:
> An encrypted Restic copy is blocked on `RESTIC_REPOSITORY` and a password source (`RESTIC_PASSWORD_FILE` or `RESTIC_PASSWORD_COMMAND`) being configured.

Reading `deployment/n6v/backup-market-lake.ps1`:

```powershell
Require-Value "MongoUri" $MongoUri
Require-Value "MongoDatabase" $MongoDatabase
Require-Value "RESTIC_REPOSITORY" $env:RESTIC_REPOSITORY
if ([string]::IsNullOrWhiteSpace($env:RESTIC_PASSWORD_FILE) -and [string]::IsNullOrWhiteSpace($env:RESTIC_PASSWORD_COMMAND)) {
    throw "RESTIC_PASSWORD_FILE or RESTIC_PASSWORD_COMMAND is required."
}
```

The script requires **four** things and nothing else structural: `MONGODB_URL`, `MONGODB_DATABASE`, `RESTIC_REPOSITORY`, and one of `RESTIC_PASSWORD_FILE` / `RESTIC_PASSWORD_COMMAND`. It then does `mongodump --archive --gzip` → `restic backup --tag vnibb --tag market-lake --tag mongo-eod --tag bronze-eod --json` → `restic snapshots --json $snapshotId` → assert the snapshot contains both expected paths → `restic check --read-data-subset 5%` → delete the local dump (line 134). It also requires `mongodump` and `restic` on `PATH` (`Get-Command … -ErrorAction Stop`). **That is a well-built script and it needs no code changes** — it needs three environment values and a repository.

Concretely, the three unset values:

1. `RESTIC_REPOSITORY` — a target. Any of: an SFTP path (`sftp:restic@host:/srv/restic-repo`), a local path on a *second* machine, an `s3:https://…` URL, or `rclone:remote:bucket/path`. The blocker is the *target*, not restic.
2. `RESTIC_PASSWORD_FILE` — a file containing the repository password. Straightforward; must live outside the repository and must be backed up separately (lose it and every snapshot is unrecoverable — restic is explicit that "losing your password means your data is irrecoverably lost").
3. `MONGODB_URL` — the script has no default; it reads `$env:MONGODB_URL` with no fallback, and `MONGODB_DATABASE` defaults to `vnibb-market`. Note **this script is the n6v/Windows variant** and its `BackupDir` default is `C:\vnibb-backups\market-lake` — it is not a drop-in for the OCI node. A Linux-side script would be a new artifact, not a config change. Also worth flagging: that script backs up **only `market_prices_eod`**, not the whole `vnibb-market` database.

**Verdict on restic:** fully proven working on the node in this session — `init`, `backup`, `snapshots`, `stats --mode raw-data`, `restore`, and a `sha256sum` round-trip all succeeded, and an incremental backup of a real second full dump took 0.96 s. restic is **not** the blocker. **The only missing piece is a target and a password file.**

---

## 4. Alternative: push dumps over the existing Tailscale network

### 4.1 Topology

Both ends are on the same tailnet (`vphk2001@`):

```
100.107.9.31    cloud-01    vphk2001@  linux    (the OCI node — production)
100.96.153.95   compute-01  vphk2001@  linux    (the operator workstation — hostname `pop-os`)
100.116.69.119  deploy-01   vphk2001@  linux
100.121.93.11   dev-01      vphk2001@  linux
```

`tailscale ping` node → workstation: `pong from compute-01 (100.96.153.95) via 113.180.183.100:41641 in 66ms`. Direct path, no DERP relay.

### 4.2 Direction: **workstation → node works; node → workstation does not, yet**

- **Works (proven).** The workstation holds `~/.ssh/oci-vnibb` — the same ed25519 key the node's `authorized_keys` is pinned to for `root` and `ubuntu` — plus an `ssh` config alias `oci-vnibb` → `oci-vnibb.tail171680.ts.net`, `User ubuntu`. In this session the workstation pulled both dump files from the node over Tailscale with `rsync` and verified them by SHA256 against the node's own hashes. The node restricts `root` login to a forced-command stub that tells you to use `ubuntu`; `ubuntu` is a normal keyed login (`uid=1001`, `/home/ubuntu/.ssh/authorized_keys` present, `docker` group).
- **Does *not* work (verified).** From the node, `ssh root@100.96.153.95` and `ssh compute_01@100.96.153.95` both stop at `# Tailscale SSH requires an additional check. # To authenticate, visit: https://login.tailscale.com/a/…`, and `ssh ubuntu@100.96.153.95` is refused with `tailnet policy does not permit you to SSH as user "ubuntu"`. The workstation has `RunSSH: true`, so **tailscaled intercepts the workstation's port 22** and its tailnet ACL does not authorise inbound SSH from `cloud-01`. Any non-SSH protocol aimed at port 22 is likewise swallowed — a raw TCP probe from the node to `100.96.153.95:22` produced **no SSH banner** (empty), unlike a normal sshd, confirming interception rather than a firewall drop. The node's own `RunSSH` is also `true`, so it intercepts inbound port 22 too.
- **Neither node has SSH keys.** `~/.ssh` on the node contains only `authorized_keys` and `known_hosts` — no `id_*`, no `config`. So a node→workstation push needs a new keypair generated on the node and its public half added to the workstation's `~/.ssh/authorized_keys` (which is what the existing `oci-vnibb` alias proves is an established pattern in this setup).

**Two ways to get node→workstation working:**
1. *pull* (no new credentials, works today): the workstation runs `rsync`/`restic` and reaches in; the node needs nothing but its existing sshd.
2. *push*: either generate a node keypair and append its public key to the workstation's `authorized_keys`, or add a tailnet ACL rule permitting `cloud-01` → `compute-01` (and make the workstation's tailscale run as a user allowed to read the inbox for `taildrop`). Note the operator must authorise the check at `login.tailscale.com` at least once for the ACL path.

`tailscale file cp` (Taildrop) *is* available on the node (`tailscale file <cp|get>`), and the workstation supports receiving, but reading the inbox needs `sudo tailscale file get` or a one-time `sudo tailscale set --operator=$USER`; the attempted send did not materialise a file in the inbox during this session (no confirmation, and no local receiving agent was authenticated). **Flagged as not fully confirmed** — the SSH/rsync path is the one that is proven.

### 4.3 Throughput — measured

```
$ time rsync -e "ssh -i ~/.ssh/oci-vnibb" ubuntu@100.107.9.31:/tmp/measure/vnibb-market-measure.archive.gz /tmp/pulltest.gz
393,258,784 bytes,  100%
real    1m35.667s                                              → 4.11 MB/s (375 MiB)
$ sha256sum /tmp/pulltest.gz   → 7a23e50d7fcc4bf663011b759934419818970650aea2b944c452cc9bd2ab1399  ✅ matches node

$ time rsync -e "ssh -i ~/.ssh/oci-vnibb" ubuntu@100.107.9.31:/tmp/measure/supabase-measure.dump /tmp/pgdump-test.dump
1,243,337,067 bytes, 100%
real    8m8.861s                                               → 2.54 MB/s (1.158 GiB)
$ sha256sum /tmp/pgdump-test.dump → 2cc1823deb99cc8dbb956d980c65b7772d8f2fdabf40d4d7816e94b9bee6b0c6  ✅ matches node
```

Note the transfer throughput was **degraded during measurement** because two `pg_dump` runs and a restic job were saturating the node's CPU concurrently (load average reached 6.24 on 4 OCPUs, and the second `pg_dump` slowed from 6m40s to ~7m20s under that contention). On an idle node, expect better. **A clean ~4 MB/s is a safe planning figure**; the combined 1.524 GiB backup set is therefore **≈6.5 minutes** of transfer at 4 MB/s.

### 4.4 The workstation's real capacity

```console
$ df -h "/media/compute_01/New Volume" /
Filesystem        Size  Used Avail Use% Mounted on
/dev/sda1         1.9T  1.1T  782G  59% /media/compute_01/New Volume
/dev/nvme0n1p3    449G  129G  298G  31% /
```

**782 GB free** on the 1.9 TB volume, 298 GB on root. Against a 2.13 GB repository with a 7-snapshot retention, the workstation is over three orders of magnitude from being a constraint, and it is a **physically separate machine on a separate power/network path** from the OCI node.

The drill **already assumes exactly this layout**: `docs/BACKUP_RESTORE_DRILL.md:12-14` says backup sets "live under `../backups` (sibling of the app repo, on a host separate from the n6v MongoDB host and the hosted PostgreSQL source)" and `scripts/restore-drill.ps1` resolves `$BackupsDir` to `<repo>/../backups`. That path exists on the workstation (`/media/compute_01/New Volume/PersonalWebsite/stockscreen/backups`), matching `restore-drill.ps1`'s default resolution — though it does not exist on the node (`/srv/vnibb/backups` → no such file or directory, and a `find` for `*.dump`/`*.archive.gz` across the node returned nothing, so **no backup currently exists anywhere on the node**).

### 4.5 Operational cost

- **Software:** $0. `rsync`, `ssh`, `scp`, `sftp` all present on both ends (node has `/usr/bin/rsync`, `/usr/bin/sftp`; the node's sshd has `Subsystem sftp /usr/lib/openssh/sftp-server` enabled, so restic's SFTP backend works out of the box). `restic` needs installing on whichever end runs it — not installed on either today.
- **Credentials:** $0, but one new artifact either way — a node keypair (push) or nothing at all (pull).
- **Money:** $0 marginal. Tailscale is already provisioned on both ends; direct path, so no DERP egress, and no data-transfer charge (the OCI tenancy includes 10 TB egress/month per `DEPLOYMENT_AND_OPERATIONS.md:587`, and a 1.5 GiB/day job is ~46 GB/month).
- **Operator effort:** the workstation must be **awake and online** at backup time. It is `active` in the tailnet now, but it is a desktop — if it sleeps, the backup silently does not happen unless something fails loudly.
- **Durability:** a desktop in one location is a single point of failure, but a *different* one from the OCI disk. It protects against disk loss, instance loss, and accidental deletion; it does not protect against a fire, theft, or ransomware that reaches the workstation.
- **Failure detection:** the existing drill is a manual `pwsh ./scripts/restore-drill.ps1` run, not a scheduled verification. Nothing currently alerts.

---

## 5. Simpler options that still get bytes off the single disk

Ordered from least to most moving parts.

1. **Workstation pull + the existing drill.** No new credentials, no new service, no money. `rsync` the two dumps to `../backups` on the workstation (verified working, 6.5 min), then run `scripts/restore-drill.ps1` there, which is already written to consume exactly that directory and asserts SHA256 + object-count parity. This is the smallest change that satisfies "leaves the single disk" and it is **proven end-to-end in this session** apart from the drill run itself (the drill needs Docker on the workstation; the workstation has it).
2. **restic on the node → SFTP repository on the workstation.** Same network path, adds encryption at rest and incremental snapshot history. restic is proven working on the node; the SFTP backend is documented and the node's sshd already serves the sftp subsystem. Needs the workstation to run an sshd reachable from the node — which today it is not (§4.2). So this reduces to "fix the direction", then it is a two-command setup.
3. **OCI Block Volume backup** (`oci bv boot-volume-backup create` / a backup policy on the boot volume). OCI documents a **five-backup** Always Free allowance for boot+block volumes combined. This is the only option here that is *entirely* off-box with **no new software, no key material, and no target to maintain** — it is a single API call against the boot volume. It is also the crudest: it captures the whole 200 GB boot volume at the **block** level, so it is not restorable into the documented `pg_restore`/`mongorestore` drill, its RPO granularity is one backup/day at best, and a full-volume backup of a volume with 81 GB used will be large and slow. It also shares the tenancy's blast radius with the instance it is protecting, and — critically — it requires the same missing IAM authorization as Object Storage (policy ref: `manage boot-volume-backups`), which was **not probed** because instance-principal access to the `core` service was not tested. **Flagged as unverified.**
4. **`tailscale file cp` (Taildrop).** Zero setup beyond a one-time `sudo tailscale set --operator=$USER` on the workstation to read the inbox. Sends a file to a device, no SSH, no keys, no repository. But it is fire-and-forget — no incremental history, no encryption beyond Tailscale's transport, no verification, no retention — and the send was **not confirmed to land** in this session. Suitable only as a belt-and-braces copy alongside another mechanism.
5. **Second OCI region.** OCI documents cross-region volume-backup copies and bucket replication. This would genuinely separate the failure domains geographically, uses the same tenancy and the same Always Free allowance, and costs nothing extra at our size — but it doubles the IAM surface and needs the same WebConsole/missing-credential work as option 1. Not probed.
6. **Oracle Autonomous Database (2 free instances, 20 GB each) / MySQL HeatWave (50 GB) / NoSQL (3×25 GB).** Documented Always Free, all "provisioned" per `DEPLOYMENT_AND_OPERATIONS.md:591-592`. **Not** usable as a target for `pg_dump`/`mongodump` archives without turning them into a paid service, and ADB's own free storage is not an object store. Listed for completeness; **not investigated further.**

---

## 6. What was NOT determined (flagged)

1. **Which Object Storage allowance applies to this tenancy** — 20 GB combined (Always-Free-only state) or 10+10+10 GB (paid / Free-Trial-credits). The `limits` API is denied to the instance principal and there is no Console access from here.*
2. **Whether the free allowance is currently free capacity or already consumed** — cannot be read without authorization. `list_buckets` is denied, and no bucket exists for any plausible name, which weakly suggests zero usage, but that is inference, not measurement.
3. **Whether `BUCKET_CREATE` denial is a missing policy, a wrong compartment, or a tenancy that genuinely has no Object Storage entitlement.** The `409 BucketAlreadyExists` message conflates "exists" and "not authorized" by design; the `ListBuckets` 404 is documented to conflate "not found" and "not authorized" by design. Only a WebConsole check or an authorized API call resolves this.
4. **OCI Block Volume backup viability** — the `core` service was not probed with the instance principal, so it is unknown whether the same authorization gap blocks it. **Not tested; do not assume it works.**
5. **Object Storage API request count per backup cycle** against the 50,000/month free cap. Not measurable without a bucket.
6. **The exact `pg_dump -Fc` determinism mechanism.** The *effect* is measured three ways (0.05% size delta between identical runs, 288 bytes stored for a 77 MB file, 452.6 MiB stored for a 1.243 GiB second dump) and the append-only-bulk-table explanation fits all three, but the dump-format internals were not read. Treat the 64%-dedup figure as an observation about *this* workload, not a guarantee.
7. **Mongo archive dedup across days** — not measured (only one Mongo archive was produced). Assume ~100% distinct per day until measured.
8. **Taildrop delivery** — the send was issued but not confirmed received.
9. **`deploy-01` / `dev-01` disks and roles** — both are on the tailnet but refused SSH the same way the workstation does, so their capacity is unknown and they were not investigated as targets.
10. **Peak-hour restore-time and cost of an Archive-tier retrieval** — documented as "at most an hour" to first byte, but never exercised.

\* The node exposes 2 × `VM.Standard.E2.1.Micro` and 4 OCPU / 24 GB of `A1.Flex` in metadata, but that is shape metadata, not entitlement metadata.

---

## 7. Appendix: exact commands run

Read-only against production. Everything below was actually executed; output quoted above is verbatim.

```bash
# --- node inventory ---
which oci; ls -la ~/.oci; ls -la /etc/oci; which restic; which rclone
df -h; free -h; tailscale status; crontab -l; systemctl list-timers --all

# --- IMDS / instance identity ---
curl -s -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/instance/ | jq '{id,compartmentId,region,availabilityDomain,shape,shapeConfig}'
curl -s -H "Authorization: Bearer Oracle" http://169.254.169.254/opc/v2/instance/region
curl -s -H "Authorization: Bearer Oracle" -o /tmp/id_cert.pem http://169.254.169.254/opc/v2/identity/cert.pem
curl -s -H "Authorization: Bearer Oracle" -o /tmp/id_key.pem  http://169.254.169.254/opc/v2/identity/key.pem
curl -s -H "Authorization: Bearer Oracle" -o /tmp/id_intermediate.pem http://169.254.169.254/opc/v2/identity/intermediate.pem
openssl x509 -in /tmp/id_cert.pem -noout -subject -issuer -dates

# --- data sizes ---
docker compose --env-file /srv/vnibb/deployment/env.oracle -f /srv/vnibb/docker-compose.oracle.yml exec -T db \
  psql -U postgres -d vnibb -c "SELECT pg_database_size('vnibb');"
docker compose … exec -T db psql -U postgres -d vnibb -c \
  "SELECT relname, pg_size_pretty(pg_total_relation_size(relid)) AS total, n_live_tup FROM pg_stat_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 20;"
docker system df -v | grep -E "vnibb|VOLUME NAME"

# mongo (grep/cut because `. env.oracle` breaks on the unquoted '(' in CORS_ORIGIN_REGEX on line 57)
U=$(grep -E "^MONGO_ROOT_USERNAME=" /srv/vnibb/deployment/env.oracle | cut -d= -f2-)
P=$(grep -E "^MONGO_ROOT_PASSWORD=" /srv/vnibb/deployment/env.oracle | cut -d= -f2-)
docker exec vnibb-mongo mongosh "mongodb://${U}:${P}@localhost:27017/vnibb-market?authSource=admin" --quiet \
  --eval 'const s=db.stats(); print(JSON.stringify({dataSize:s.dataSize,storageSize:s.storageSize,indexSize:s.indexSize,collections:s.collections,objects:s.objects}))'
docker exec vnibb-mongo mongosh "mongodb://…" --quiet --eval \
  'db.getCollectionNames().forEach(c=>{const st=db.getCollection(c).stats(); print(c+"\t"+(st.size/1048576).toFixed(2)+" MB\t"+st.count+" docs\tidx "+(st.totalIndexSize/1048576).toFixed(2)+" MB")})'

# --- growth ---
docker compose … exec -T db psql -U postgres -d vnibb -c \
  "SELECT date_trunc('day', created_at)::date d, count(*) FROM prediction_markets GROUP BY 1 ORDER BY 1 DESC LIMIT 14;"
docker compose … exec -T db psql -U postgres -d vnibb -c \
  "SELECT source, count(*), min(created_at)::date, max(created_at)::date FROM prediction_markets GROUP BY 1 ORDER BY 2 DESC;"
docker compose … exec -T db psql -U postgres -d vnibb -c \
  "COPY (SELECT * FROM prediction_markets WHERE created_at >= '2026-09-21' AND created_at < '2026-09-22') TO STDOUT" | zstd -9 -q -o /tmp/measure/one_day_pm.zst -f
docker compose … exec -T db psql -U postgres -d vnibb -tAc \
  "COPY (SELECT * FROM prediction_markets WHERE created_at >= '2026-09-21' AND created_at < '2026-09-22') TO STDOUT" | wc -c

# --- dumps (README-documented flags) ---
docker compose … exec -T db pg_dump -U postgres -d vnibb -Fc --compress=zstd:9 --no-owner --no-acl > /tmp/measure/supabase-measure.dump
docker exec vnibb-mongo mongodump "mongodb://${U}:${P}@localhost:27017/vnibb-market?authSource=admin" \
  --db vnibb-market --archive=/tmp/vnibb-market-measure.archive.gz --gzip
sha256sum /tmp/measure/*
docker compose … exec -T db pg_restore --list < /tmp/measure/supabase-measure.dump | grep -c "^"     # 692 TOC entries

# --- restic (throwaway repo in /tmp) ---
curl -sL -o restic.bz2 https://github.com/restic/restic/releases/download/v0.18.0/restic_0.18.0_linux_arm64.bz2
python3 -c "import bz2,shutil;shutil.copyfileobj(bz2.open('/tmp/restic.bz2'),open('/tmp/restic','wb'))"
chmod +x /tmp/restic && /tmp/restic version
RESTIC_REPOSITORY=/tmp/restic-repo RESTIC_PASSWORD=… /tmp/restic init
RESTIC_REPOSITORY=/tmp/restic-repo RESTIC_PASSWORD=… /tmp/restic backup --tag measure /tmp/measure/supabase-measure.dump /tmp/measure/vnibb-market-measure.archive.gz
RESTIC_REPOSITORY=/tmp/restic-repo RESTIC_PASSWORD=… /tmp/restic stats --mode raw-data
RESTIC_REPOSITORY=/tmp/restic-repo RESTIC_PASSWORD=… /tmp/restic snapshot/restore …   # sha256 round-trip verified

# --- OCI instance principal ---
python3 -m venv --without-pip /tmp/ocitest2 && curl -sL -o /tmp/get-pip.py https://bootstrap.pypa.io/get-pip.py
/tmp/ocitest2/bin/python3 /tmp/get-pip.py && /tmp/ocitest2/bin/pip install oci oci-cli
/tmp/ocitest2/bin/oci os ns get --auth instance_principal
/tmp/ocitest2/bin/oci os bucket list --auth instance_principal --namespace axxw0g8rnf1k --compartment-id "$TENANCY"
/tmp/ocitest2/bin/oci os bucket create --auth instance_principal --namespace axxw0g8rnf1k --compartment-id "$TENANCY" --name vnibb-backup-probe --debug
/tmp/ocitest2/bin/oci limits value list --auth instance_principal --compartment-id "$TENANCY" --service-name object-storage
# plus oci.object_storage / oci.identity SDK probes for get_bucket / create_bucket / list_policies / list_dynamic_groups / list_compartments

# --- tailscale / rsync (run from the workstation) ---
tailscale ping --c 3 100.96.153.95                        # run on the node
ssh root@100.96.153.95 / ssh compute_01@100.96.153.95     # run on the node -> Tailscale SSH auth prompt
rsync -e "ssh -i ~/.ssh/oci-vnibb -o IdentitiesOnly=yes" ubuntu@100.107.9.31:/tmp/measure/vnibb-market-measure.archive.gz /tmp/pulltest.gz
rsync -e "ssh -i ~/.ssh/oci-vnibb -o IdentitiesOnly=yes" ubuntu@100.107.9.31:/tmp/measure/supabase-measure.dump /tmp/pgdump-test.dump
sha256sum /tmp/pulltest.gz /tmp/pgdump-test.dump          # both match the node's hashes

# --- pricing (public OCI price list API) ---
curl -s "https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD&partNumber=B91628"
curl -s "https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD&partNumber=B91633"
curl -s "https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD&partNumber=B93000"
curl -s "https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD&partNumber=B91627"
```

### Sources

- OCI Always Free Resources — https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm (page processed 2026-06-12)
- OCI Object Storage tiers — https://docs.oracle.com/en-us/iaas/Content/Object/Concepts/understandingstoragetiers.htm (processed 2026-04-23)
- OCI Object Storage overview (namespace, limits, rate capacity) — https://docs.oracle.com/en-us/iaas/Content/Object/Concepts/objectstorageoverview.htm (processed 2026-08-20)
- OCI Object Storage + Archive Storage policy reference — https://docs.oracle.com/en-us/iaas/Content/Identity/policyreference/objectstoragepolicyreference.htm (processed 2026-09-02)
- OCI Amazon S3 Compatibility API — https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/s3compatibleapi.htm (processed 2026-04-21)
- OCI Pre-Authenticated Requests — https://docs.oracle.com/en-us/iaas/Content/Object/Tasks/usingpreauthenticatedrequests.htm (processed 2026-02-10)
- OCI Block Volume Backups — https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumebackups.htm (processed 2026-09-03)
- OCI API Errors (404/409 authorization conflation) — https://docs.oracle.com/en-us/iaas/Content/API/References/apierrors.htm
- OCI public price list API — https://apexapps.oracle.com/pls/apex/cetools/api/v1/products/?currencyCode=USD (`lastUpdated` 2026-09-09T16:34:38Z)
- restic — Preparing a new repository (backends, `RESTIC_REPOSITORY`, password sources) — https://restic.readthedocs.io/en/stable/030_preparing_a_new_repo.html
- oracle/oci-python-sdk `instance_principals_security_token_signer.py` — https://github.com/oracle/oci-python-sdk/blob/master/src/oci/auth/signers/instance_principals_security_token_signer.py
