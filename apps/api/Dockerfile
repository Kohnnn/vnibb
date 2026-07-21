# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

WORKDIR /app

ARG DEBIAN_FRONTEND=noninteractive
ARG IMAGE_RELEASE_REVISION=unknown
ARG VNSTOCK_INSTALLER_SHA256
ARG VNSTOCK_PREMIUM_REQUIRED_MODULES=vnstock_data,vnstock_ta,vnstock_pipeline,vnstock_news,vnii

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/opt/venv/lib/python3.12/site-packages \
    TZ=Asia/Ho_Chi_Minh \
    VNSTOCK_INTERACTIVE=0 \
    VNSTOCK_LANGUAGE=2 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    curl \
    git \
    libpq-dev \
    tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && python -m venv /opt/venv

COPY . .

RUN printf '%s\n' "$IMAGE_RELEASE_REVISION" > /app/.release-revision

RUN pip install --no-cache-dir --upgrade pip setuptools wheel \
    && pip install --no-cache-dir . \
    && python -c "from importlib.metadata import version; print(f'vnstock {version(\"vnstock\")} | vnai {version(\"vnai\")}')"

RUN --mount=type=secret,id=vnstock_api_key,required=false \
    set -eu; \
    if [ -s /run/secrets/vnstock_api_key ]; then \
        test -n "$VNSTOCK_INSTALLER_SHA256"; \
        curl --fail --silent --show-error --location https://vnstocks.com/files/vnstock-cli-installer.run --output /tmp/vnstock-cli-installer.run; \
        printf '%s  %s\n' "$VNSTOCK_INSTALLER_SHA256" /tmp/vnstock-cli-installer.run | sha256sum --check --status -; \
        chmod +x /tmp/vnstock-cli-installer.run; \
        /tmp/vnstock-cli-installer.run -- --api-key "$(cat /run/secrets/vnstock_api_key)"; \
        premium_site_packages="$(find /root/.venv/lib -type d -path '*/site-packages' -print -quit)"; \
        test -n "$premium_site_packages"; \
        for module in $(printf '%s' "$VNSTOCK_PREMIUM_REQUIRED_MODULES" | tr ',' ' '); do find "$premium_site_packages" -maxdepth 1 -name "${module}*" -exec cp -a {} /opt/venv/lib/python3.12/site-packages/ \;; done; \
        pip install --no-cache-dir html2text pta_reload tqdm; \
        VNSTOCK_MODULES="$VNSTOCK_PREMIUM_REQUIRED_MODULES" python -c "import importlib, os; [importlib.import_module(module.strip()) for module in os.environ['VNSTOCK_MODULES'].split(',') if module.strip()]"; \
        rm -rf /tmp/vnstock-cli-installer.run /root/.venv; \
    fi

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh \
    && useradd -m -u 1000 appuser \
    && chown -R appuser:appuser /app /opt/venv

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD sh -c 'curl -fsS "http://localhost:${PORT:-8000}/ready" || exit 1'

USER appuser

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
