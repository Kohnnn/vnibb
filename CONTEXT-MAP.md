# Context Map

## Contexts

- [api](./apps/api/CONTEXT.md) — assembles, filters, and serves screens of Vietnamese listed equities
- [web](./apps/web/CONTEXT.md) — the widget dashboard through which users compose and read those screens

## Relationships

- **web → api**: web holds no market data. Every number on the dashboard is a screen result read over HTTP.
- **web → api**: filter criteria cross the boundary as one serialized blob, not as typed fields. The api owns the vocabulary of filterable fields; web only names them. Anything the api can only learn from typed parameters is invisible to it when web is the caller.
- **api → web**: the api reports availability, source, scope, and data dates separately from rows. A zero-match screen is available; a provider failure without fallback is unavailable. A daily screener Universe requires a completed full-run coverage record, while a symbol read may still succeed without one. Heatmap price freshness does not imply its constituents are current; unknown dates remain unknown. The web renders these states rather than replacing unavailable quotes with zero.
