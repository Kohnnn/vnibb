# Context Map

## Contexts

- [api](./apps/api/CONTEXT.md) — assembles, filters, and serves screens of Vietnamese listed equities
- [web](./apps/web/CONTEXT.md) — the widget dashboard through which users compose and read those screens

## Relationships

- **web → api**: web holds no market data. Every number on the dashboard is a screen result read over HTTP.
- **web → api**: filter criteria cross the boundary as one serialized blob, not as typed fields. The api owns the vocabulary of filterable fields; web only names them. Anything the api can only learn from typed parameters is invisible to it when web is the caller.
- **api → web**: the api reports not just rows but the state of the data behind them, so web can tell "nothing matched" apart from "this data was unavailable".
