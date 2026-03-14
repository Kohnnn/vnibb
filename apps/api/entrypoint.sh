#!/bin/sh
set -e
export PYTHONUNBUFFERED=1
echo "ENTRYPOINT STARTED: User $(whoami)"

# 1. Database Migrations
echo "Running database migrations..."
if [ -z "${ALEMBIC_STRICT:-}" ]; then
    runtime_environment=$(printf "%s" "${ENVIRONMENT:-}" | tr '[:upper:]' '[:lower:]')
    if [ "$runtime_environment" = "production" ]; then
        ALEMBIC_STRICT=1
        echo "ALEMBIC_STRICT not set; defaulting to 1 for production startup."
    else
        ALEMBIC_STRICT=0
    fi
fi

if alembic upgrade head; then
    echo "Database migrations completed."
else
    strict_flag=$(printf "%s" "$ALEMBIC_STRICT" | tr '[:upper:]' '[:lower:]')
    case "$strict_flag" in
        1|true|yes|on)
            echo "ERROR: alembic migration failed and ALEMBIC_STRICT=1. Exiting."
            exit 1
            ;;
        *)
            echo "WARNING: alembic migration failed. Continuing startup (ALEMBIC_STRICT=0)."
            ;;
    esac
fi

# 2. Check for VnStock Premium Packages
VENV_PATH="/root/.venv"
SYSTEM_SITE_PACKAGES="/usr/local/lib/python3.12/site-packages"
VENV_SITE_PACKAGES="$VENV_PATH/lib/python3.12/site-packages"
PYTHON_BIN="python3"
SITE_PACKAGES="$SYSTEM_SITE_PACKAGES"
VNSTOCK_RUNTIME_INSTALL="${VNSTOCK_RUNTIME_INSTALL:-0}"
VNSTOCK_AUTO_BOOTSTRAP_ON_MISSING="${VNSTOCK_AUTO_BOOTSTRAP_ON_MISSING:-1}"
VNSTOCK_AUTO_BOOTSTRAP_INTERVAL_SECONDS="${VNSTOCK_AUTO_BOOTSTRAP_INTERVAL_SECONDS:-43200}"
VNSTOCK_AUTO_BOOTSTRAP_MAX_FAILED_ATTEMPTS="${VNSTOCK_AUTO_BOOTSTRAP_MAX_FAILED_ATTEMPTS:-5}"
VNSTOCK_AUTO_BOOTSTRAP_LOCK_STALE_SECONDS="${VNSTOCK_AUTO_BOOTSTRAP_LOCK_STALE_SECONDS:-1800}"
VNSTOCK_PREMIUM_REQUIRED_MODULES="${VNSTOCK_PREMIUM_REQUIRED_MODULES:-vnstock_data,vnstock_ta,vnstock_pipeline,vnstock_news,vnii}"

venv_ready() {
    if [ -x "$VENV_PATH/bin/python" ]; then
        # Ignore inherited PYTHONPATH when probing venv health; otherwise system
        # site-packages can cause false positives for modules not installed in venv.
        PYTHONPATH="" "$VENV_PATH/bin/python" -c "import uvicorn" >/dev/null 2>&1 && return 0
    fi
    return 1
}

set_python_env() {
    if venv_ready; then
        PYTHON_BIN="$VENV_PATH/bin/python"
        SITE_PACKAGES="$VENV_SITE_PACKAGES"
        export VIRTUAL_ENV="$VENV_PATH"
        export PATH="$VENV_PATH/bin:$PATH"
        export PYTHONPATH="$SITE_PACKAGES"
    else
        PYTHON_BIN="python3"
        SITE_PACKAGES="$SYSTEM_SITE_PACKAGES"
        export PYTHONPATH="$SITE_PACKAGES"
    fi
}

ensure_venv() {
    if [ ! -x "$VENV_PATH/bin/python" ]; then
        python3 -m venv "$VENV_PATH"
    fi
}

activate_venv_for_installer() {
    ensure_venv
    export VIRTUAL_ENV="$VENV_PATH"
    export PATH="$VENV_PATH/bin:$PATH"
    export PYTHONPATH="$VENV_SITE_PACKAGES"
    "$VENV_PATH/bin/python" -m pip install -U pip requests >/dev/null 2>&1 || true
}

backup_has_vnstock() {
    if [ -d "$PERSISTENT_BACKUP" ]; then
        ls "$PERSISTENT_BACKUP"/vnstock_data* >/dev/null 2>&1 && return 0
    fi
    return 1
}

runtime_install_enabled() {
    runtime_install_flag=$(printf "%s" "$VNSTOCK_RUNTIME_INSTALL" | tr '[:upper:]' '[:lower:]')
    case "$runtime_install_flag" in
        1|true|yes|on) return 0 ;;
        *) return 1 ;;
    esac
}

auto_bootstrap_enabled() {
    auto_flag=$(printf "%s" "$VNSTOCK_AUTO_BOOTSTRAP_ON_MISSING" | tr '[:upper:]' '[:lower:]')
    case "$auto_flag" in
        1|true|yes|on) return 0 ;;
        *) return 1 ;;
    esac
}

epoch_now() {
    date +%s
}

read_epoch_file() {
    file_path="$1"
    if [ -f "$file_path" ]; then
        value=$(cat "$file_path" 2>/dev/null || true)
        case "$value" in
            ''|*[!0-9]*) echo 0 ;;
            *) echo "$value" ;;
        esac
    else
        echo 0
    fi
}

write_epoch_file() {
    file_path="$1"
    value="$2"
    printf "%s" "$value" > "$file_path"
}

read_int_file() {
    file_path="$1"
    default_value="$2"
    if [ -f "$file_path" ]; then
        value=$(cat "$file_path" 2>/dev/null || true)
        case "$value" in
            ''|*[!0-9]*) echo "$default_value" ;;
            *) echo "$value" ;;
        esac
    else
        echo "$default_value"
    fi
}

premium_modules_ready() {
    output=$(VNSTOCK_MODULES="$VNSTOCK_PREMIUM_REQUIRED_MODULES" "$PYTHON_BIN" - <<'PY'
import importlib
import os
import sys

raw = os.getenv("VNSTOCK_MODULES", "")
modules = [m.strip() for m in raw.split(",") if m.strip()]
missing = []
for mod in modules:
    try:
        importlib.import_module(mod)
    except Exception:
        missing.append(mod)

if missing:
    print("MISSING:" + ",".join(missing))
    raise SystemExit(1)

print("OK")
PY
)
    status=$?
    if [ "$status" -ne 0 ]; then
        echo "VNStock Premium: required modules check failed ($output)."
        return 1
    fi
    return 0
}

sync_premium_modules_from_venv_to_system() {
    if [ ! -d "$VENV_SITE_PACKAGES" ] || [ ! -d "$SYSTEM_SITE_PACKAGES" ]; then
        return 1
    fi

    synced=0
    old_ifs="$IFS"
    IFS=','
    for raw_mod in $VNSTOCK_PREMIUM_REQUIRED_MODULES; do
        mod=$(printf "%s" "$raw_mod" | tr -d '[:space:]')
        if [ -z "$mod" ]; then
            continue
        fi

        if ls "$VENV_SITE_PACKAGES"/${mod}* >/dev/null 2>&1; then
            cp -r "$VENV_SITE_PACKAGES"/${mod}* "$SYSTEM_SITE_PACKAGES"/ 2>/dev/null || true
            synced=1
        fi
    done
    IFS="$old_ifs"

    if [ "$synced" -eq 1 ]; then
        echo "VNStock Premium: synchronized modules from venv to system site-packages."
        return 0
    fi

    return 1
}

acquire_bootstrap_lock() {
    now_ts=$(epoch_now)

    if mkdir "$VNSTOCK_BOOTSTRAP_LOCK_DIR" 2>/dev/null; then
        write_epoch_file "$VNSTOCK_BOOTSTRAP_LOCK_TS_FILE" "$now_ts"
        return 0
    fi

    lock_ts=$(read_epoch_file "$VNSTOCK_BOOTSTRAP_LOCK_TS_FILE")
    stale_after="$VNSTOCK_AUTO_BOOTSTRAP_LOCK_STALE_SECONDS"
    case "$stale_after" in
        ''|*[!0-9]*) stale_after=1800 ;;
    esac

    if [ "$lock_ts" -gt 0 ]; then
        unlock_ts=$((lock_ts + stale_after))
        if [ "$now_ts" -ge "$unlock_ts" ]; then
            echo "VNStock Premium: stale bootstrap lock detected, recovering lock."
            rm -rf "$VNSTOCK_BOOTSTRAP_LOCK_DIR" 2>/dev/null || true
            mkdir "$VNSTOCK_BOOTSTRAP_LOCK_DIR" 2>/dev/null || return 1
            write_epoch_file "$VNSTOCK_BOOTSTRAP_LOCK_TS_FILE" "$now_ts"
            return 0
        fi
    fi

    return 1
}

release_bootstrap_lock() {
    rm -rf "$VNSTOCK_BOOTSTRAP_LOCK_DIR" 2>/dev/null || true
}

should_auto_bootstrap() {
    if ! auto_bootstrap_enabled; then
        return 1
    fi

    interval="$VNSTOCK_AUTO_BOOTSTRAP_INTERVAL_SECONDS"
    case "$interval" in
        ''|*[!0-9]*) interval=43200 ;;
    esac

    now_ts=$(epoch_now)
    last_ts=$(read_epoch_file "$VNSTOCK_LAST_BOOTSTRAP_ATTEMPT_FILE")
    failed_count=$(read_int_file "$VNSTOCK_BOOTSTRAP_FAILED_COUNT_FILE" 0)
    max_failed="$VNSTOCK_AUTO_BOOTSTRAP_MAX_FAILED_ATTEMPTS"
    case "$max_failed" in
        ''|*[!0-9]*) max_failed=5 ;;
    esac

    if [ "$failed_count" -ge "$max_failed" ]; then
        echo "VNStock Premium: auto-bootstrap paused after ${failed_count} consecutive failures."
        echo "Set VNSTOCK_RUNTIME_INSTALL=1 for a forced one-time attempt or reset state files."
        return 1
    fi

    if [ "$last_ts" -le 0 ]; then
        return 0
    fi

    next_ts=$((last_ts + interval))
    if [ "$now_ts" -ge "$next_ts" ]; then
        return 0
    fi

    wait_seconds=$((next_ts - now_ts))
    echo "VNStock Premium: auto-bootstrap cooldown active (${wait_seconds}s remaining)."
    return 1
}

set_python_env

# If key is provided but packages are missing (e.g. build arg was missed), install them now.
if [ -n "$VNSTOCK_API_KEY" ]; then
    # PERSISTENCE LOGIC: Define backup path in the mounted volume
    PERSISTENT_BACKUP="/root/.vnstock/backup_packages"
    VNSTOCK_STATE_DIR="/root/.vnstock/runtime_state"
    VNSTOCK_LAST_BOOTSTRAP_ATTEMPT_FILE="$VNSTOCK_STATE_DIR/last_bootstrap_attempt.epoch"
    VNSTOCK_BOOTSTRAP_FAILED_COUNT_FILE="$VNSTOCK_STATE_DIR/bootstrap_failed_count.int"
    VNSTOCK_BOOTSTRAP_LOCK_DIR="$VNSTOCK_STATE_DIR/bootstrap.lock"
    VNSTOCK_BOOTSTRAP_LOCK_TS_FILE="$VNSTOCK_STATE_DIR/bootstrap.lock.epoch"
    mkdir -p "$VNSTOCK_STATE_DIR"

    # 2a. Restore Code: If we have a backup, restore it first
    if backup_has_vnstock; then
        echo "VnStock Premium: Restoring packages from persistent volume..."
        ensure_venv
        set_python_env
        cp -rn "$PERSISTENT_BACKUP"/* "$SITE_PACKAGES/" || true
    fi

    # 2b. Check Execution: Now check if it works
    if ! premium_modules_ready; then
        if sync_premium_modules_from_venv_to_system; then
            set_python_env
            if premium_modules_ready; then
                echo "VNStock Premium: modules restored from venv cache without reinstall."
            fi
        fi
    fi

    if ! premium_modules_ready; then
        INSTALL_PREMIUM_AT_RUNTIME=0

        if runtime_install_enabled; then
            INSTALL_PREMIUM_AT_RUNTIME=1
        elif should_auto_bootstrap; then
            echo "VNStock Premium: Missing modules detected. Triggering scheduled auto-bootstrap attempt."
            INSTALL_PREMIUM_AT_RUNTIME=1
        fi

        if [ "$INSTALL_PREMIUM_AT_RUNTIME" -ne 1 ]; then
            echo "WARNING: VNStock premium packages missing and VNSTOCK_RUNTIME_INSTALL=0."
            echo "         Use prebuilt premium image (Dockerfile.premium) or set VNSTOCK_RUNTIME_INSTALL=1 for one-time bootstrap."
            echo "         Continuing in free mode."
        else
            if ! acquire_bootstrap_lock; then
                echo "WARNING: VNStock bootstrap lock is active. Skipping duplicate install attempt."
                INSTALL_PREMIUM_AT_RUNTIME=0
            fi
        fi

        if [ "$INSTALL_PREMIUM_AT_RUNTIME" -eq 1 ]; then
            echo "----------------------------------------------------------------"
            echo "VnStock Premium: Key found but packages missing."
            echo "Installing premium packages at runtime..."
            echo "----------------------------------------------------------------"

            # Ensure installer exists
            if [ ! -f /app/vnstock-cli-installer.run ]; then
                wget -q https://vnstocks.com/files/vnstock-cli-installer.run -O /app/vnstock-cli-installer.run
                chmod +x /app/vnstock-cli-installer.run
            fi

            # Run installer (non-fatal if it fails)
            activate_venv_for_installer
            epoch_now > "$VNSTOCK_LAST_BOOTSTRAP_ATTEMPT_FILE"
            set +e
            /app/vnstock-cli-installer.run -- --api-key "$VNSTOCK_API_KEY"
            INSTALL_STATUS=$?
            set -e
            set_python_env

            if [ "$INSTALL_STATUS" -ne 0 ]; then
                failed_count=$(read_int_file "$VNSTOCK_BOOTSTRAP_FAILED_COUNT_FILE" 0)
                failed_count=$((failed_count + 1))
                write_epoch_file "$VNSTOCK_BOOTSTRAP_FAILED_COUNT_FILE" "$failed_count"
                echo "WARNING: VNStock installer failed (exit=$INSTALL_STATUS). Continuing without premium packages."
            else
                # Ensure vnii is up to date for premium checks
                if [ -x "$VENV_PATH/bin/python" ]; then
                    "$VENV_PATH/bin/python" -m pip install --upgrade --extra-index-url https://vnstocks.com/api/simple vnii >/dev/null 2>&1 || true
                else
                    "$PYTHON_BIN" -m pip install --upgrade --extra-index-url https://vnstocks.com/api/simple vnii >/dev/null 2>&1 || true
                fi

                # Installer writes premium packages into /root/.venv.
                # Runtime may execute with system python, so sync premium modules.
                sync_premium_modules_from_venv_to_system || true
                set_python_env

                # 2c. Backup Code: Save the newly installed packages to volume
                echo "VnStock Premium: Backing up packages to persistent volume..."
                mkdir -p "$PERSISTENT_BACKUP"
                # Copy vnstock related packages AND vnii to avoid bloating
                cp -r "$SITE_PACKAGES"/vnstock* "$PERSISTENT_BACKUP/" 2>/dev/null || true
                cp -r "$SITE_PACKAGES"/vnii* "$PERSISTENT_BACKUP/" 2>/dev/null || true

                if premium_modules_ready; then
                    write_epoch_file "$VNSTOCK_BOOTSTRAP_FAILED_COUNT_FILE" 0
                    echo "VnStock Premium: Installation and backup complete."
                else
                    failed_count=$(read_int_file "$VNSTOCK_BOOTSTRAP_FAILED_COUNT_FILE" 0)
                    failed_count=$((failed_count + 1))
                    write_epoch_file "$VNSTOCK_BOOTSTRAP_FAILED_COUNT_FILE" "$failed_count"
                    echo "WARNING: VNStock installer finished but required premium modules are still missing."
                fi
            fi

            release_bootstrap_lock
        fi
    else
        echo "VnStock Premium: Packages checked and ready."
        write_epoch_file "$VNSTOCK_BOOTSTRAP_FAILED_COUNT_FILE" 0
    fi
else
    echo "WARNING: VNSTOCK_API_KEY not found. Running in free mode."
fi

# 3. Start Application
APP_PORT="${PORT:-${WEB_PORT:-8000}}"
case "$APP_PORT" in
    ''|*[!0-9]*)
        case "${WEB_PORT:-}" in
            ''|*[!0-9]*) APP_PORT="8000" ;;
            *) APP_PORT="${WEB_PORT}" ;;
        esac
        ;;
esac

echo "Resolved ports: PORT='${PORT:-}' WEB_PORT='${WEB_PORT:-}' APP_PORT='${APP_PORT}'"
echo "Starting VNIBB API on port ${APP_PORT}..."
UVICORN_PROXY_HEADERS="${UVICORN_PROXY_HEADERS:-1}"
FORWARDED_ALLOW_IPS="${FORWARDED_ALLOW_IPS:-*}"

set -- -m uvicorn vnibb.api.main:app --host 0.0.0.0 --port "$APP_PORT"
proxy_flag=$(printf "%s" "$UVICORN_PROXY_HEADERS" | tr '[:upper:]' '[:lower:]')
case "$proxy_flag" in
    1|true|yes|on)
        set -- "$@" --proxy-headers --forwarded-allow-ips "$FORWARDED_ALLOW_IPS"
        ;;
esac

if "$PYTHON_BIN" -c "import uvicorn" >/dev/null 2>&1; then
    exec "$PYTHON_BIN" "$@"
fi

echo "WARNING: Selected interpreter ($PYTHON_BIN) missing uvicorn. Falling back to system python3."
exec python3 "$@"
