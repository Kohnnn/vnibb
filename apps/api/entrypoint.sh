#!/bin/sh
set -e
export PYTHONUNBUFFERED=1
echo "ENTRYPOINT STARTED: User $(whoami)"

# 1. Database Migrations
echo "Running database migrations..."
ALEMBIC_STRICT="${ALEMBIC_STRICT:-0}"

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

venv_ready() {
    if [ -x "$VENV_PATH/bin/python" ]; then
        "$VENV_PATH/bin/python" -c "import uvicorn" >/dev/null 2>&1 && return 0
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

set_python_env

# If key is provided but packages are missing (e.g. build arg was missed), install them now.
if [ -n "$VNSTOCK_API_KEY" ]; then
    # PERSISTENCE LOGIC: Define backup path in the mounted volume
    PERSISTENT_BACKUP="/root/.vnstock/backup_packages"

    # 2a. Restore Code: If we have a backup, restore it first
    if backup_has_vnstock; then
        echo "VnStock Premium: Restoring packages from persistent volume..."
        ensure_venv
        set_python_env
        cp -rn "$PERSISTENT_BACKUP"/* "$SITE_PACKAGES/" || true
    fi

    # 2b. Check Execution: Now check if it works
    if ! "$PYTHON_BIN" -c "import vnstock_data" 2>/dev/null; then
        if ! runtime_install_enabled; then
            echo "WARNING: VNStock premium packages missing and VNSTOCK_RUNTIME_INSTALL=0."
            echo "         Use prebuilt premium image (Dockerfile.premium) or set VNSTOCK_RUNTIME_INSTALL=1 for one-time bootstrap."
            echo "         Continuing in free mode."
        else
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
            set +e
            /app/vnstock-cli-installer.run -- --api-key "$VNSTOCK_API_KEY"
            INSTALL_STATUS=$?
            set -e
            set_python_env

            if [ "$INSTALL_STATUS" -ne 0 ]; then
                echo "WARNING: VNStock installer failed (exit=$INSTALL_STATUS). Continuing without premium packages."
            else
                # Ensure vnii is up to date for premium checks
                if [ -x "$VENV_PATH/bin/python" ]; then
                    "$VENV_PATH/bin/python" -m pip install --upgrade --extra-index-url https://vnstocks.com/api/simple vnii >/dev/null 2>&1 || true
                else
                    "$PYTHON_BIN" -m pip install --upgrade --extra-index-url https://vnstocks.com/api/simple vnii >/dev/null 2>&1 || true
                fi

                # 2c. Backup Code: Save the newly installed packages to volume
                echo "VnStock Premium: Backing up packages to persistent volume..."
                mkdir -p "$PERSISTENT_BACKUP"
                # Copy vnstock related packages AND vnii to avoid bloating
                cp -r "$SITE_PACKAGES"/vnstock* "$PERSISTENT_BACKUP/" 2>/dev/null || true
                cp -r "$SITE_PACKAGES"/vnii* "$PERSISTENT_BACKUP/" 2>/dev/null || true

                echo "VnStock Premium: Installation and backup complete."
            fi
        fi
    else
        echo "VnStock Premium: Packages checked and ready."
    fi
else
    echo "WARNING: VNSTOCK_API_KEY not found. Running in free mode."
fi

# 3. Start Application
echo "Starting VNIBB API..."
exec "$PYTHON_BIN" -m uvicorn vnibb.api.main:app --host 0.0.0.0 --port 8000
