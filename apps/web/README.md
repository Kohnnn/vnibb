# VniBB Web

<div align="center">

**Research cockpit for Vietnamese equities**

[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)

[Live app](https://web.vnibb.xyz) · [Report bug](https://github.com/Kohnnn/vnibb/issues) · [Request feature](https://github.com/Kohnnn/vnibb/issues)

</div>

---

## Overview

The VniBB web workspace: a modular research cockpit for Vietnamese equities, built with the Next.js App Router.

---

## 🚀 Features

- **40+ Financial Widgets** - Screener, charts, fundamentals
- **Dark Mode** - Beautiful UI with dark/light themes
- **Real-time Data** - WebSocket connections for live updates
- **Responsive** - Mobile, tablet, desktop optimized
- **Fast** - Server-side rendering + edge caching
- **Main System Dashboard** - Permanent read-only fallback dashboard that prevents empty-state crashes
- **External Intelligence Hub** - Research widget uses categorized outbound links (no brittle iframes)
- **Quant Library Grouping** - Volume Profile, Gap Fill, Volume Delta, and Amihud are grouped under Quant

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
- Node.js 20.9+
- pnpm (recommended)

### Installation

```bash
# Clone the monorepo
git clone https://github.com/Kohnnn/vnibb.git
cd vnibb/apps/web

# Install dependencies
pnpm install

# Configure the required environment variables in .env.local (see below)

# Start development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## 🌐 Deployment

The Vercel project is configured for this workspace in [`vercel.json`](./vercel.json). Deployments use the linked project; `vercel --prod` publishes to its configured production target.

```bash
vercel --prod
```

### Environment Variables

```env
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_WS_URL=wss://api.example.com/api/v1/ws/prices
NEXT_PUBLIC_AUTH_PROVIDER=supabase
NEXT_PUBLIC_ENABLE_AUTH=false
```

`NEXT_PUBLIC_ENABLE_AUTH` controls dashboard login redirects, not backend admin authorization. Interactive admin operations always require a real Supabase session for an immutable operator UUID in backend `ADMIN_USER_IDS` (empty denies). There is no browser shared-key admin mode; never expose `ADMIN_API_KEY` or `SUPABASE_JWT_SECRET` in frontend variables/storage. Clear any previously stored admin key and rotate the formerly browser-exposed server secret; clearing alone does not revoke it. Supabase auth is separate from serving PostgreSQL. See [`admin_global_system_layouts.md`](../../docs/admin_global_system_layouts.md) and [`oracle_runbook.md`](../../docs/oracle_runbook.md) for backend session limits/revocation and the BLOCKED production migration/acceptance gate.

---

## 📚 Documentation

Workspace docs:
- `../../docs/WIDGET_CATALOG.md`
- `../../docs/API_REFERENCE.md`
- `../../CHANGELOG.md`

---

## 🧪 Testing

```bash
# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint

# Build
pnpm build
```

---

## 📜 License

MIT License - see [LICENSE](LICENSE)

---

## Related

- [Repository](https://github.com/Kohnnn/vnibb) — monorepo root, backend service and docs
- `/brand` route — live brand and channel reference in the app

---

<div align="center">

**Part of the [VniBB](https://github.com/Kohnnn/vnibb) project**

</div>
