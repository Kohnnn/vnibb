# VNIBB Providers - Data Provider Package

<div align="center">

**Python Data Providers for Vietnamese Market**

[![PyPI version](https://badge.fury.io/py/vnibb-providers.svg)](https://pypi.org/project/vnibb-providers/)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)

</div>

---

## 📋 Overview

Shared provider package for VNIBB's Python data integrations.

Right now this package is only a thin placeholder around vnstock credentials/dependency wiring. The production-grade vnstock integration still lives in `vnibb/apps/api`, where the fallback, caching, and normalization logic is implemented.

Upstream alignment:
- Official `vnstocks.com` docs currently document stable releases through `v3.4.2`.
- VNIBB currently pins the newer GitHub-main/runtime line via `vnstock>=3.5.0` in `pyproject.toml`.
- That means KBS-first behavior is assumed and `TCBS` should be treated as removed.

---

## 🚀 Features

- **Shared dependency anchor** - Keeps the repo's standalone providers package aligned to the vnstock runtime line used by VNIBB.
- **Credential placeholder** - Exposes a minimal `VnstockProvider` wrapper for future extraction work.
- **Roadmap package** - Intended home for reusable providers as logic is carved out of `apps/api`.

---

## 📦 Installation

```bash
pip install vnibb-providers
```

---

## 🎯 Usage

```python
from vnibb_providers import VnstockProvider

# Current implementation is intentionally thin.
provider = VnstockProvider(api_key="vnstock_xxx")

print(provider.api_key)
```

If you need the actual market-data integration today, use one of these instead:
- `vnibb/apps/api` for the full VNIBB backend integration
- `https://github.com/thinh-vu/vnstock` for the upstream Python library
- `https://github.com/mrgoonie/vnstock-agent` for MCP/CLI workflows

---

## 🔌 Providers

| Provider | Data Source | Status |
|----------|-------------|--------|
| `VnstockProvider` | Minimal wrapper stub | ✅ Present |
| Shared extracted provider API | VNIBB backend parity | 🔄 Planned |
| `CafeProvider` | cafef.vn | 🔄 Planned |
| `VNDirectProvider` | vndirect.com.vn | 🔄 Planned |

---

## 🧪 Development

```bash
# Clone
git clone https://github.com/Kohnnn/vnibb-providers.git

# Install
pip install -e ".[dev]"

# Test
pytest

# Build
python -m build
```

---

## 📜 License

MIT License - see [LICENSE](LICENSE)

---

<div align="center">

**Part of the [VNIBB](https://github.com/Kohnnn/vnibb) project**

</div>
