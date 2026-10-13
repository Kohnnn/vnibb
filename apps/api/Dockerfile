# syntax=docker/dockerfile:1.7
FROM python:3.12-slim

WORKDIR /app

ARG DEBIAN_FRONTEND=noninteractive
ARG IMAGE_RELEASE_REVISION=unknown

ENV PATH=/opt/venv/bin:$PATH \
    PYTHONPATH=/opt/venv/lib/python3.12/site-packages \
    TZ=Asia/Ho_Chi_Minh \
    VNSTOCK_INTERACTIVE=0 \
    VNSTOCK_LANGUAGE=2 \
    VNSTOCK_RUNTIME_TIER=free \
    VNSTOCK_SOURCE=VCI \
    VNSTOCK_RUNTIME_INSTALL=0 \
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
    && pip install --isolated --no-cache-dir --index-url https://pypi.org/simple -c constraints-vnstock.txt . \
    && python -c "from importlib.metadata import version; print(f'vnstock {version(\"vnstock\")} | vnai {version(\"vnai\")}')"

RUN python -c "from importlib.util import find_spec; modules = ('vnstock_data', 'vnstock_ta', 'vnstock_pipeline', 'vnstock_news', 'vnii'); present = [name for name in modules if find_spec(name) is not None]; assert not present, f'Paid modules are forbidden in the free image: {present}'"

COPY entrypoint.sh .
RUN chmod +x entrypoint.sh \
    && useradd -m -u 1000 appuser \
    && chown -R appuser:appuser /app /opt/venv

HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 \
    CMD sh -c 'curl -fsS "http://localhost:${PORT:-8000}/ready" || exit 1'

USER appuser

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
