FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    wget \
    curl \
    ca-certificates \
    git \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Environment for non-interactive vnstock installation
ENV VNSTOCK_LANGUAGE=2 \
    VNSTOCK_INTERACTIVE=0 \
    PYTHONUNBUFFERED=1

# Create directories
RUN mkdir -p /root/.vnstock /app/data /app/logs

# Download vnstock CLI installer
RUN wget -q https://vnstocks.com/files/vnstock-cli-installer.run \
    -O /app/vnstock-cli-installer.run && \
    chmod +x /app/vnstock-cli-installer.run

# Install Python dependencies
COPY pyproject.toml ./
RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir .

# Install vnstock premium packages via CLI installer
# The API key is passed as build arg for installation
ARG VNSTOCK_API_KEY
RUN if [ -n "$VNSTOCK_API_KEY" ]; then \
    echo "Installing vnstock premium packages with API key..."; \
    /app/vnstock-cli-installer.run -- --api-key "$VNSTOCK_API_KEY"; \
    else \
    echo "WARNING: VNSTOCK_API_KEY not provided. Premium packages not installed."; \
    fi

# Verify vnstock installation
RUN python3 -c "import vnstock; print(f'vnstock {vnstock.__version__} installed')" || true

# Copy application code
COPY . .

# Create non-root user for security
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Expose port
EXPOSE 8000

# Run application
# Run migrations and start application
CMD ["sh", "-c", "alembic upgrade head && uvicorn vnibb.api.main:app --host 0.0.0.0 --port 8000"]
