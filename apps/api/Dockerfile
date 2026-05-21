FROM python:3.12-slim

WORKDIR /app

ARG DEBIAN_FRONTEND=noninteractive

# Install system dependencies
# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    curl \
    ca-certificates \
    git \
    tzdata \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Fix: Ensure installed packages are importable by scripts
ENV PYTHONPATH=/usr/local/lib/python3.12/site-packages
ENV TZ=Asia/Ho_Chi_Minh

# Environment for non-interactive vnstock installation
ENV VNSTOCK_LANGUAGE=2 \
    VNSTOCK_INTERACTIVE=0 \
    VNSTOCK_RUNTIME_INSTALL=0 \
    PYTHONUNBUFFERED=1

# Create directories
RUN mkdir -p /root/.vnstock /app/data /app/logs

# Download vnstock CLI installer
RUN wget -q https://vnstocks.com/files/vnstock-cli-installer.run \
    -O /app/vnstock-cli-installer.run && \
    chmod +x /app/vnstock-cli-installer.run

# Copy application source first (pyproject build needs README/package files)
COPY . .

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir . \
    && pip install --no-cache-dir --upgrade "vnstock>=3.5.0,<3.6" "vnai>=2.4.0,<2.5" \
    && python3 -c "from importlib.metadata import version; print(f'vnstock {version(\"vnstock\")} | vnai {version(\"vnai\")}')"

# Optional: install vnii from VNStock index for premium checks.
# Do not fail the image build if index/package is unavailable.
ARG VNSTOCK_EXTRA_INDEX_URL=https://vnstocks.com/api/simple
RUN pip install --no-cache-dir --extra-index-url "${VNSTOCK_EXTRA_INDEX_URL}" "vnii>=0.1.5" || \
    echo "INFO: vnii unavailable from extra index; continuing in free-compatible mode."

# Explicitly verify vnai remains importable for the installer/runtime path
RUN python3 -c "import vnai; print(f'vnai installed at {vnai.__file__}')"

# Premium runtime bootstrap. When VNSTOCK_API_KEY is provided as a build
# arg, install the Golden Sponsor packages (vnstock_news, vnstock_data,
# vnstock_ta, vnstock_pipeline) so the news crawler and insider providers
# work out of the box. Falls back gracefully when the key is absent.
#
# Previously this was commented out, requiring operators to either build
# with Dockerfile.premium or run a manual `pip install` inside the
# container after each redeploy. That manual step kept getting missed
# and left market_news stale for 35+ days (B1 from the QA evaluation
# report). Re-enabling the bootstrap closes the gap.
ARG VNSTOCK_API_KEY
RUN if [ -n "$VNSTOCK_API_KEY" ]; then \
    echo "Installing vnstock premium packages with API key..."; \
    /app/vnstock-cli-installer.run -- --api-key "$VNSTOCK_API_KEY" || \
    echo "WARNING: vnstock-cli-installer failed; runtime will rely on free-tier sources."; \
    else \
    echo "WARNING: VNSTOCK_API_KEY not provided. Premium packages not installed."; \
    fi

# Premium transitive dependencies. The vnstock Golden Sponsor packages
# pull these in as runtime imports but the installer above does not
# always install them, leaving `import vnstock_news` and
# `import vnstock_ta` failing inside the running container even after a
# successful premium bootstrap. We pin them explicitly so future rebuilds
# never regress (QA-v2 oracle rebuild — discovered when re-deploying
# v1.3.0 left market_news pipeline still producing 0 articles).
RUN pip install --no-cache-dir html2text pta_reload tqdm


# Copy entrypoint script and set permissions (as root)
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh

# Create non-root user and set ownership
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app

# Health check (support PORT or WEB_PORT runtime env)
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD sh -c 'curl -f "http://localhost:${PORT:-8000}/live" || curl -f "http://localhost:${WEB_PORT:-8000}/live" || exit 1'

# Switch to non-root user
# USER appuser

# Expose port
EXPOSE 8000

# Run application via entrypoint
ENTRYPOINT ["./entrypoint.sh"]
