#!/bin/bash
set -e
export PYTHONUNBUFFERED=1
echo "ENTRYPOINT STARTED: User $(whoami)"

# 1. Database Migrations
echo "Running database migrations..."
alembic upgrade head

# 2. Check for VnStock Premium Packages
# Fix: Ensure installer can find vnai
export PYTHONPATH=/usr/local/lib/python3.12/site-packages

# If key is provided but packages are missing (e.g. build arg was missed), install them now.
if [ -n "$VNSTOCK_API_KEY" ]; then
    if ! python3 -c "import vnstock_data" 2>/dev/null; then
        echo "----------------------------------------------------------------"
        echo "VnStock Premium: Key found but packages missing."
        echo "Installing premium packages at runtime..."
        echo "----------------------------------------------------------------"
        
        # Ensure installer exists
        if [ ! -f /app/vnstock-cli-installer.run ]; then
            wget -q https://vnstocks.com/files/vnstock-cli-installer.run -O /app/vnstock-cli-installer.run
            chmod +x /app/vnstock-cli-installer.run
        fi
        
        # Run installer
        /app/vnstock-cli-installer.run -- --api-key "$VNSTOCK_API_KEY"
        
        echo "VnStock Premium: Installation complete."
    else
        echo "VnStock Premium: Packages already installed."
    fi
else
    echo "WARNING: VNSTOCK_API_KEY not found. Running in free mode."
fi

# 3. Start Application
echo "Starting VNIBB API..."
exec uvicorn vnibb.api.main:app --host 0.0.0.0 --port 8000
