# API

The backend domain. It assembles screens of Vietnamese listed equities from three sources — a live vnstock feed, a daily-materialized Postgres snapshot, and a Mongo fundamentals corpus — and answers filtered queries over them.

## Screening

**Universe**:
Every active listed symbol on HOSE, HNX, and UPCOM. Roughly 1,700, of which about 1,570 carry fundamentals.
_Avoid_: all stocks, the market, full list

**Candidate Set**:
The rows a request considers before any limit is applied. A filter's answer is only trustworthy if its Candidate Set was the whole Universe.
_Avoid_: result set, working set, dataset

**Page**:
The limited slice of the Candidate Set actually returned. A Page is an output. Nothing is ever filtered against a Page.
_Avoid_: batch, chunk, window

**Advanced Filter**:
A criterion evaluated in-process against the Candidate Set, whether it arrived as a typed range parameter or inside the serialized filter blob. Distinct from the exchange, industry, and universe restrictions, which narrow the Candidate Set earlier and by different means.
_Avoid_: complex filter, custom filter, user filter

**Screen Scope**:
Whether a screen's Candidate Set was the whole Universe or only a Page. A full-Universe screen answers "which symbols match". A Page-scoped screen answers only "which of these arbitrary hundred match". The two look identical in a response body, so every response states which it was.
_Avoid_: coverage, completeness, depth

## Snapshots

**Screener Snapshot**:
One symbol's screener row for one day, materialized in Postgres by the daily sync. Collectively, the Universe as the api knows it.
_Avoid_: cache entry, cached row

**Verified Universe Snapshot**:
A day's Screener Snapshots whose symbol set matches the completed daily full-Universe run. A partial run or a collection of rows without that completion record is not a Verified Universe Snapshot, even if the rows have recent write timestamps.
_Avoid_: complete cache, latest rows

**Market Trade Date**:
The date of the market observation represented by a price or screener row, distinct from the day it was materialized and the time it was written. Unknown provenance remains unknown; a recent write does not make an old market observation current.
_Avoid_: refresh time, write date

**Constituent Date**:
The oldest known date among the included heatmap constituents. It can lag the freshest price date; missing constituent dates do not certify a fresh heatmap.
_Avoid_: heatmap update time

**Fundamental Snapshot**:
One symbol's computed valuation record for one day, held in Mongo and rebuilt on its own cadence. Independent of the Screener Snapshot and carrying its own as-of date.
_Avoid_: fundamentals cache, valuation cache

**Fundamental Enrichment**:
Joining Fundamental Snapshots onto a Candidate Set. Best-effort by contract: failure leaves the fields empty rather than failing the screen.
_Avoid_: merge, hydration, fundamental fetch

## Fields

**Fundamental Field**:
One of the seven values from the fundamental valuation layer: intrinsic value, margin of safety, moat, dividend years, FCF positive, valuation method, and the fundamental as-of date. Naming any one of them in a filter, a sort, or a column request is what obliges a screen to perform Fundamental Enrichment.
_Avoid_: valuation field, fundamentals

**Discovery Field**:
Listing age, target price, target upside, and recommendation. The sibling group to Fundamental Fields, sourced from Postgres rather than Mongo, and already enriched before filtering.
_Avoid_: profile field

**Intrinsic Value**:
A model-derived estimate of what one share is worth, in VND. A reference estimate, not advice.

**Margin of Safety**:
How far a symbol's price sits below its Intrinsic Value, as a percentage. A reference estimate, not advice.

**Moat**:
A label for the durability of a company's competitive advantage: wide, narrow, none, or eroding. A reference estimate, not advice.
