# VNIBB Web - Frontend Application

<div align="center">

**Next.js Frontend for VNIBB Financial Platform**

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Kohnnn/vnibb-web)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

[Live Demo](https://vnibb.vercel.app) · [Report Bug](https://github.com/Kohnnn/vnibb-web/issues) · [Request Feature](https://github.com/Kohnnn/vnibb-web/issues)

</div>

---

## 📋 Overview

Modern, responsive web application for Vietnamese stock market analysis. Built with Next.js 16 App Router and optimized for Vercel deployment.

---

## 🚀 Features

- **40+ Financial Widgets** - Screener, charts, fundamentals
- **Dark Mode** - Beautiful UI with dark/light themes
- **Real-time Data** - WebSocket connections for live updates
- **Responsive** - Mobile, tablet, desktop optimized
- **Fast** - Server-side rendering + edge caching

---

## 🛠️ Tech Stack

- **Framework:** Next.js 16 (App Router)
- **Language:** TypeScript 5.0
- **Styling:** Tailwind CSS
- **State:** React 18 hooks
- **Charts:** Lightweight Charts, Recharts
- **API:** Fetch API + SWR

---

## 📁 Project Structure

```
src/
├── app/              # Next.js App Router pages
├── components/       # React components
│   ├── widgets/      # Financial widgets
│   ├── ui/           # UI primitives
│   └── layout/       # Layout components
├── hooks/            # Custom React hooks
├── lib/              # Utilities
└── types/            # TypeScript types
```

---

## 🏃 Quick Start

### Prerequisites
- Node.js 18+
- pnpm (recommended)

### Installation

```bash
# Clone repository
git clone https://github.com/Kohnnn/vnibb-web.git
cd vnibb-web

# Install dependencies
pnpm install

# Setup environment
cp .env.example .env.local

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 🌐 Deployment

### Deploy to Vercel (Recommended)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Kohnnn/vnibb-web)

Or via CLI:
```bash
vercel --prod
```

### Environment Variables

```env
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

## 🧪 Testing

```bash
# Run tests
pnpm test

# Type check
pnpm type-check

# Lint
pnpm lint

# Build
pnpm build
```

---

## 📜 License

MIT License - see [LICENSE](LICENSE)

---

## 🔗 Related Repos

- [vnibb-api](https://github.com/Kohnnn/vnibb-api) - Backend API
- [vnibb-widgets](https://github.com/Kohnnn/vnibb-widgets) - Widget library
- [vnibb](https://github.com/Kohnnn/vnibb) - Main hub

---

<div align="center">

**Part of the [VNIBB](https://github.com/Kohnnn/vnibb) project**

</div>
