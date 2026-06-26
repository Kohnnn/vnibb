# VNIBB Widgets - React Component Library

<div align="center">

**Financial Widget Components for Vietnamese Market**

[![npm version](https://badge.fury.io/js/%40vnibb%2Fwidgets.svg)](https://www.npmjs.com/package/@vnibb/widgets)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

</div>

---

## 📋 Overview

Reusable React widget components for building financial applications focused on the Vietnamese stock market.

> **Status: Intentional future-extraction stub.**
> This package is kept in the workspace as a placeholder for a future
> widget-library extraction. All production widgets currently live in
> `apps/web/src/components/widgets`. This package is not imported by
> `apps/web` today. Do not add production dependencies on it until real
> widgets are extracted here.

---

## 🚀 Features

- **40+ Widgets** - Screener, charts, fundamentals, news
- **TypeScript** - Full type safety
- **Customizable** - Props for configuration
- **Responsive** - Mobile-first design
- **Accessible** - WCAG 2.1 compliant

---

## 📦 Installation

```bash
npm install @vnibb/widgets
# or
pnpm add @vnibb/widgets
# or
yarn add @vnibb/widgets
```

---

## 🎯 Usage

```tsx
import { 
  ScreenerWidget, 
  FinancialsWidget,
  PriceChartWidget 
} from '@vnibb/widgets';

function Dashboard() {
  return (
    <div>
      <ScreenerWidget 
        exchange="HOSE" 
        limit={100}
      />
      <FinancialsWidget 
        symbol="VNM"
        period="annual"
      />
      <PriceChartWidget 
        symbol="VNM"
        interval="1D"
      />
    </div>
  );
}
```

---

## 🧩 Available Widgets

| Widget | Description |
|--------|-------------|
| `ScreenerWidget` | Stock screener with filters |
| `FinancialsWidget` | Financial statements table |
| `PriceChartWidget` | Stock price chart |
| `ComparisonWidget` | Multi-stock comparison |
| `KeyMetricsWidget` | Key financial metrics |
| `NewsWidget` | Market news feed |
| `SectorWidget` | Sector performance |
| `HeatmapWidget` | Market heatmap |

[See all widgets →](https://vnibb.vercel.app/widgets)

---

## 🎨 Customization

```tsx
<ScreenerWidget 
  exchange="HOSE"
  limit={50}
  theme="dark"
  onSymbolClick={(symbol) => console.log(symbol)}
/>
```

---

## 🧪 Development

```bash
# Clone repo
git clone https://github.com/Kohnnn/vnibb-widgets.git

# Install
pnpm install

# Build
pnpm build

# Watch mode
pnpm dev
```.

---

## 📜 License

MIT License - see [LICENSE](LICENSE)

---

## 🔗 Related Repos

- [vnibb-web](https://github.com/Kohnnn/vnibb-web) - Web app using these widgets
- [vnibb-ui](https://github.com/Kohnnn/vnibb-ui) - Base UI components
- [vnibb](https://github.com/Kohnnn/vnibb) - Main hub

---

<div align="center">

**Part of the [VNIBB](https://github.com/Kohnnn/vnibb) project**

</div>
