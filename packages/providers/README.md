# VNIBB Providers - Data Provider Package

<div align="center">

**Python Data Providers for Vietnamese Market**

[![PyPI version](https://badge.fury.io/py/vnibb-providers.svg)](https://pypi.org/project/vnibb-providers/)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)

</div>

---

## 📋 Overview

Python package providing unified interface to Vietnamese stock market data sources, powered by vnstock.

---

## 🚀 Features

- **vnstock Integration** - Golden Sponsor API support
- **Async/Await** - High-performance async operations
- **Type Safety** - Full Pydantic models
- **Caching** - Built-in cache layer
- **Retry Logic** - Automatic retry on failures

---

## 📦 Installation

```bash
pip install vnibb-providers
```

---

## 🎯 Usage

```python
from vnibb_providers import VnstockProvider

# Initialize
provider = VnstockProvider(api_key="your-key")

# Get stock data
stock = await provider.get_stock("VNM")

# Get financials
financials = await provider.get_financials("VNM", period="annual")

# Screen stocks
results = await provider.screen_stocks(
    exchange="HOSE",
    filters={"pe": "<15"}
)
```

---

## 🔌 Providers

| Provider | Data Source | Status |
|----------|-------------|--------|
| `VnstockProvider` | vnstock v3.4.0+ | ✅ Active |
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
