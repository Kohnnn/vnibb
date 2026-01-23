# VNIBB - Vietnam-First Financial Analytics Platform

<div align="center">

![VNIBB Logo](https://raw.githubusercontent.com/Kohnnn/vnibb/085295eca4ea948e7d0fcb258b3716bdb274230a/logo.svg)

**Financial data platform for Vietnamese market analysts, quants and AI agents**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.12+](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/downloads/)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)

[Demo](https://vnibb-web.vercel.app/) · [N/A](https://github.com/Kohnnn/vnibb-docs) · [Contributing](#contributing)

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
Visit [vnibb-web.vercel.app](https://vnibb-web.vercel.app/)

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

---

## 🤝 Contributing

We welcome contributions!

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

Made with 🇻🇳stock by [Kohnnn](https://github.com/Kohnnn)

</div>
