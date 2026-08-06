# Fundamental filters screen the full Universe

Fundamental Enrichment runs before the Candidate Set is truncated to a Page, not after. The obvious placement — enrich only the rows you are about to return — is cheaper but silently wrong: a filter on a Fundamental Field would then refine whatever arbitrary slice survived truncation, so "positive free cash flow" would mean "of the first hundred symbols in listing order, those with positive free cash flow." Discovery Fields already enrich before filtering and limiting; we match that shape rather than inventing a second one.

The cost is one bulk Mongo aggregation over the whole Universe rather than over a Page, on any request that names a Fundamental Field. Requests naming none skip it entirely, which is the property worth protecting.

## Consequences

- Truncation happens in two places, not one: the early-limit shortcut taken when no Advanced Filter is present, and the final slice. Both must sit after enrichment, so the decision "does this request touch fundamentals" has to be made before either.
- The aggregation leans on the `(symbol, snapshotDate)` index on the fundamentals collection. That index is created only by the manual backfill script, so its presence is asserted at startup rather than assumed.
- On the live vnstock path the Universe is already truncated upstream at fetch time, so full-Universe screening is unreachable there no matter where enrichment sits. Live results are page-scoped by construction, and that is a property of the feed, not of this decision.
