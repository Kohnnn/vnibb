#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: $0 registry.example.com/vnibb/api:<release-tag>}"
revision="${IMAGE_RELEASE_REVISION:-}"
platform="${PLATFORM:-linux/arm64}"

case "$platform" in
  linux/amd64|linux/arm64) ;;
  *)
    echo "Unsupported VNStock 5.2.1 image platform: $platform; use linux/amd64 or linux/arm64" >&2
    exit 1
    ;;
esac

if [[ -z "$revision" ]]; then
  revision="$(git rev-parse --verify HEAD)"
fi
python_bin="${PYTHON_BIN:-}"
args=(--platform "$platform" --build-arg "IMAGE_RELEASE_REVISION=$revision"
  --label "org.opencontainers.image.revision=$revision"
  --label "org.opencontainers.image.source=https://github.com/Kohnnn/vnibb")

if [[ -z "$python_bin" ]]; then
  for candidate in python3 python py; do
    if command -v "$candidate" >/dev/null 2>&1; then
      python_bin="$(command -v "$candidate")"
      break
    fi
  done
fi

if [[ -z "$python_bin" ]]; then
  echo "No Python interpreter found on PATH to parse build metadata" >&2
  exit 1
fi

if [[ "${image##*/}" != *:* || "$image" == *@* ]]; then
  echo "Release image must include an explicit tag: $image" >&2
  exit 1
fi


metadata_file="$(mktemp)"
trap 'rm -f "$metadata_file"' EXIT

docker buildx build "${args[@]}" --push --metadata-file "$metadata_file" -t "$image" apps/api

digest="$("$python_bin" - "$metadata_file" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as metadata_file:
    metadata = json.load(metadata_file)

digest = metadata.get("containerimage.digest")
if not digest:
    descriptor = metadata.get("containerimage.descriptor")
    if isinstance(descriptor, dict):
        digest = descriptor.get("digest")
if isinstance(digest, str):
    print(digest)
PY
)"

if [[ ! "$digest" =~ ^sha256:[[:xdigit:]]{64}$ ]]; then
  echo "Published image digest unavailable from build metadata: $image" >&2
  exit 1
fi

repository="${image%:*}"
tag="${image##*:}"
printf '{"repository":"%s","digest":"%s","image":"%s@%s","revision":"%s","platform":"%s","tag":"%s"}\n' "$repository" "$digest" "$repository" "$digest" "$revision" "$platform" "$tag"
