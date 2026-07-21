#!/usr/bin/env bash
set -euo pipefail

cat <<'EOF'
Retired: premium modules must be installed during the immutable image build.
Do not modify deployment/env.oracle or install packages in a running container.

Build and publish a replacement image with:
  scripts/oracle/build_release_image.sh registry.example.com/vnibb/api:<release-tag>

For premium modules, set VNSTOCK_API_KEY_FILE and VNSTOCK_INSTALLER_SHA256 before running that command. Then update VNIBB_API_IMAGE_REPOSITORY and VNIBB_API_IMAGE_DIGEST through the documented deployment process.
EOF

exit 1
