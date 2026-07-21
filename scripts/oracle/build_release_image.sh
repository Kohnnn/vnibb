#!/usr/bin/env bash
set -euo pipefail

image="${1:?usage: $0 registry.example.com/vnibb/api:<release-tag>}"
revision="${IMAGE_RELEASE_REVISION:-$(git rev-parse --verify HEAD)}"
platform="${PLATFORM:-linux/arm64}"
args=(--platform "$platform" --build-arg "IMAGE_RELEASE_REVISION=$revision")

if [[ -n "${VNSTOCK_API_KEY_FILE:-}" ]]; then
  : "${VNSTOCK_INSTALLER_SHA256:?VNSTOCK_INSTALLER_SHA256 is required with VNSTOCK_API_KEY_FILE}"
  args+=(--secret "id=vnstock_api_key,src=$VNSTOCK_API_KEY_FILE" --build-arg "VNSTOCK_INSTALLER_SHA256=$VNSTOCK_INSTALLER_SHA256")
fi

docker buildx build "${args[@]}" --push -t "$image" apps/api
