# VNIBB - Vietnam-First Financial Analytics Platform

<div align="center">

![VNIBB Logo](https://via.placeholder.com/150)

**Financial data platform for Vietnamese market analysts, quants and AI agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)

[Demo](https://vnibb.vercel.app) · [Docs](https://github.com/Kohnnn/vnibb-docs) · [Contributing](#contributing)

</div>

---

## 🚀 What is VNIBB?

VNIBB (Vietnam Investment Building Blocks) is an **open-source financial analytics platform** specifically designed for the **Vietnamese stock market**. Built with modern web technologies, it provides:

- 📊 **40+ Financial Widgets** - Real-time market data visualization
- 🔍 **Advanced Stock Screener** - Filter 1000+ Vietnamese stocks
- 📈 **Technical Analysis** - Charts, indicators, and patterns
- 💼 **Company Fundamentals** - Financial statements, ratios, news
- 🤖 **AI-Ready** - OpenBB-inspired architecture for quant analysis

---

## 🏗️ Architecture

VNIBB follows a **modular multi-repo** design:

| Repository | Description | Tech Stack |
|------------|-------------|------------|
| [vnibb-web](https://github.com/Kohnnn/vnibb-web) | Frontend application | Next.js 16, React, Tailwind |
| [vnibb-api](https://github.com/Kohnnn/vnibb-api) | Backend API | FastAPI, SQLAlchemy, PostgreSQL |
| [vnibb-widgets](https://github.com/Kohnnn/vnibb-widgets) | Widget library | React 18, TypeScript |
| [vnibb-providers](https://github.com/Kohnnn/vnibb-providers) | Data providers | vnstock, Python |
| [vnibb-docs](https://github.com/Kohnnn/vnibb-docs) | Documentation | Docusaurus |

---

## ✨ Features

### For Investors
- Real-time Vietnamese stock data (HOSE, HNX, UPCOM)
- Advanced filtering & screening tools
- Financial statement analysis
- Technical indicators & charts

### For Developers
- OpenBB-inspired modular architecture
- RESTful API with 50+ endpoints
- React widget library (npm package)
- Python data provider (PyPI package)

### For Quants
- Historical price data (10+ years)
- Fundamental metrics & ratios
- Sector & industry classification
- Export to CSV/Excel

---

## 🎯 Quick Start

### Option 1: Use Hosted Version
Visit [vnibb.vercel.app](https://vnibb.vercel.app)

### Option 2: Run Locally

```bash
# Clone repos
git clone https://github.com/Kohnnn/vnibb-web.git
git clone https://github.com/Kohnnn/vnibb-api.git

# Start frontend
cd vnibb-web
pnpm install
pnpm dev

# Start backend
cd vnibb-api
python -m venv .venv
pip install -e .
uvicorn vnibb.api.main:app --reload
```

---

## 📦 Packages

### NPM Packages
```bash
npm install @vnibb/widgets
```

### Python Packages
```bash
pip install vnibb-providers
```

---

## 🤝 Contributing

We welcome contributions! Please see:
- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Development Setup](https://github.com/Kohnnn/vnibb-docs)

---

## 📊 Status

**Total Phases:** 73 across 17 sprints ✅  
**Production:** Ready for deployment  
**License:** MIT  
**Maintained:** Actively developed

---

## 📜 License

MIT License - see [LICENSE](LICENSE) file

---

## 🙏 Acknowledgments

- Inspired by [OpenBB](https://github.com/OpenBB-finance/OpenBB)
- Data powered by [vnstock](https://github.com/thinh-vu/vnstock)
- Built with ❤️ for Vietnamese investors

---

<div align="center">

**[⭐ Star this repo](https://github.com/Kohnnn/vnibb)** if you find it useful!

Made with 🇻🇳 by [Kohnnn](https://github.com/Kohnnn)

</div>
