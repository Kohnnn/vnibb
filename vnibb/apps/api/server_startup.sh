#!/bin/bash

# VNIBB Backend Startup Script
# Usage: ./server_startup.sh [port] [host]

PORT=${1:-8000}
HOST=${2:-0.0.0.0}

echo "🚀 Starting VNIBB Backend on $HOST:$PORT..."
echo "📍 Entry point: vnibb.api.main:app"

# Ensure we are in the backend directory
cd "$(dirname "$0")"

# Start uvicorn
uvicorn vnibb.api.main:app --host "$HOST" --port "$PORT" --reload
