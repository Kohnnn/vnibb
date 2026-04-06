# Development Journal

## Purpose of this journal

This is not a commit log and not a changelog. It is a developer journal that explains how VNIBB has evolved, what the project was trying to become at each stage, what went wrong, what was learned, and how those lessons changed the next decisions.

It is meant to capture progress, thinking, obstacles, research process, and the reasoning behind major pivots.

## 1. The original idea: a Vietnam-first OpenBB-style workspace

VNIBB started from a clear product instinct: there was room for a serious research workspace focused on Vietnamese equities, but most local tools were fragmented. Some were good at market snapshots, some were good at financial statements, some were good at screeners, and some were good at charting, but few combined them into one coherent research system.

OpenBB became the architectural and product reference point, not because the goal was to copy it blindly, but because it represented a strong mental model:

- modular surfaces instead of one monolithic page
- dense but purposeful information design
- platform-first thinking rather than one-off scripts
- a system that could support both people and agentic workflows

The early product thesis was basically this: if OpenBB-style composability could be reinterpreted for Vietnam, with local data providers and local market assumptions, the result could be much more useful than a generic equity dashboard.

## 2. Foundation phase: choose architecture before polish

The project moved early toward a split architecture:

- Next.js frontend for the workspace UI
- FastAPI backend for data orchestration
- a provider/service model rather than direct frontend-to-provider coupling
- a widget-based dashboard instead of hard-coded pages

This was an important decision because it avoided a common trap: building a visually rich frontend too early on top of unstable and inconsistent data flows.

The backend was treated as a real product layer, not only as a transport layer. That choice paid off later when provider quirks, missing values, bank-specific edge cases, and deployment issues began to appear.

## 3. Early reality check: local-market data is messy

One of the first hard lessons was that local market data is not clean enough for naive product construction.

Problems showed up in forms like:

- missing change percentages
- inconsistent field naming across sources
- malformed dates
- incomplete index and mover payloads
- financial statement gaps
- bank metrics that made sense for industrial issuers but not for banks

This changed the development mindset. Instead of assuming the backend should expose provider truth, the team had to build a normalization layer that produced product truth.

That was a key maturity step.

## 4. Building the dashboard as a research cockpit

The widget system became the central product abstraction. This let the app evolve into dashboards for different intents instead of a single overloaded screen.

That helped in two ways.

First, it matched how actual research works. A user might want:

- a fundamentals-heavy layout
- a technical layout
- a quant workflow
- a market-monitoring board
- a bank-focused dashboard

Second, it made iterative shipping easier. New analytical ideas could become widgets and templates instead of forcing a redesign of the whole app.

This also introduced a new challenge: too much flexibility can create clutter. That is one of the themes that returns in later phases, especially around consolidating financial widgets and improving dashboard hierarchy.

## 5. The first major obstacle: production is where assumptions get punished

The deployment journals show a clear pattern: issues that looked small in local development became critical in production.

Examples from the earlier deployment era included:

- package version mismatches at build time
- database connection string problems
- CORS mismatches between frontend and backend domains
- missing frontend env vars
- WebSocket path mismatches
- health-check timing issues during runtime install/bootstrap

The important lesson was not just that deployment is hard. It was that production failures exposed weak assumptions about the whole system.

For example:

- a wrong WebSocket path was not just a config bug; it revealed weak contract clarity between frontend and backend
- unstable startup behavior revealed that runtime dependency installation was too fragile
- database and platform shifts revealed how much operational truth needs to be documented, not guessed

## 6. Research process improved through debugging

A pattern emerges in the journals and phase docs: the project got better when debugging became more evidence-driven.

The team repeatedly moved from guesswork to structured diagnosis by using:

- health endpoints
- focused smoke tests
- cross-symbol validation
- provider-specific log inspection
- live runtime audits
- comparison against OpenBB and Vietnamese product benchmarks

That shift matters. Many early failures could have been "papered over" at the widget level. Instead, the better path was to ask:

- is the contract wrong
- is the source wrong
- is the fallback order wrong
- is the cache behavior wrong
- is the UI accurately representing uncertainty

That style of questioning is what turned the project from a dashboard experiment into a more resilient product.

## 7. UI and UX rescue: parity is not only about features

One of the earlier evaluation reports was brutally useful because it highlighted that parity gaps were not only about missing widgets. There were also UX credibility problems:

- broken light mode
- transparent or unreadable popups
- persistent skeleton states
- weak routing after search
- misleading default placeholders

This was a major insight. Product quality is not just "how many endpoints exist" or "how many widgets exist." If the app looks unstable or ambiguous, user trust collapses even when the data layer is improving.

That drove a more serious UX posture:

- cleaner loading and empty states
- stronger widget ergonomics
- more deliberate dashboard organization
- more serious table presentation
- more contextual help for users inside widgets

## 8. Phase 7: closing real financial-data gaps before chasing novelty

Phase 7 shows a mature prioritization move.

Instead of jumping directly to flashy new surfaces, the project first fixed high-value P0 and P1 gaps in financial data and infrastructure quality.

Key progress included:

- enriching financial statements with missing fields like SG&A, depreciation, and EBITDA
- improving balance sheet and cash flow completeness
- exposing ratios such as ROIC, EV/Sales, and FCF yield more reliably
- reordering statement data oldest-to-newest for better analysis
- strengthening admin sync visibility and backend resilience
- improving the frontend financial tables and footers

The thinking here was strong: make the core numbers trustworthy before adding more visual layers.

This phase also shows an important product habit: defer work deliberately. New widgets were postponed so that foundational trust issues could be fixed first.

## 9. Phase 8: expand the product where Vietnam-specific workflows matter most

Once the core financial surfaces improved, the project expanded into distinctive product territory.

Phase 8 was a major milestone because it added both breadth and local specificity.

Highlights:

- bank-specific normalization
- bank-native KPI support
- bank analytics widget
- transaction flow widget
- industry bubble widget
- sector board widget
- money flow trend widget
- correlation matrix implementation

This phase is one of the clearest examples of the project's thesis becoming real.

The app was no longer only filling parity gaps. It was building a stronger Vietnamese-market workflow language.

### Obstacle: banks break generic assumptions

Bank issuers forced a deeper kind of product thinking.

The wrong solution would have been to keep serving generic industrial ratios for banks just to avoid null values. The better solution, which the project adopted, was:

- null out misleading metrics when necessary
- derive bank-appropriate measures where possible
- present banks as a distinct analytical class

That is a sign of product maturity: choosing semantic honesty over fake completeness.

## 10. Phase 9: make the dashboard tell a better story

By Phase 9, the problem was no longer "do we have enough widgets?" It was "does the workflow make sense to a human analyst?"

That led to work on:

- removing distracting header clutter
- reordering quant and technical widgets into a story-driven flow
- adding explanatory widget tooltips
- splitting technical surfaces more coherently
- improving market news filtering
- hardening UX visibility and control behaviors
- improving TradingView usage and dashboard enrichment

This phase reflects an important mental shift: serious products are not just feature-complete, they are cognitively well-sequenced.

The work on widget descriptions is especially telling. It recognizes that sophisticated analysis tools need built-in teaching, not just data rendering.

## 11. Phase 10: accuracy and UX hierarchy become the next frontier

Phase 10 planning focused on a more advanced set of questions:

- are quant metrics using the latest possible data
- is signal logic too biased
- are dashboards organized around meaningful top-level groups
- are controls visually prominent enough for real usage
- do advanced users get richer context and caveats

This is a good example of the project moving from implementation breadth to decision-quality refinement.

### Obstacle: latest-data analytics are harder than static analytics

The challenge here is subtle. A quant widget can be mathematically correct on stale data and still be product-wrong.

That forced the team to think more carefully about:

- current incomplete periods
- live quote merging into historical series
- cache invalidation and freshness boundaries
- when a "current" signal should be treated as provisional

This is where product design and data engineering start to overlap tightly.

## 12. Phase 11: from many widgets to better workflow composition

The active context shows that the project has now reached another natural transition point.

The current gaps are not mostly missing data fields. They are composition and navigation gaps:

- folder-level symbol scope instead of dashboard-local scope
- consolidated financial statements instead of fragmented widgets
- categorized peer comparison instead of one flat table
- stronger table hierarchy like zebra striping and grouped rows
- tighter inline controls for symbol and timeframe changes

This is a healthy sign. It means the product is entering a refinement phase where workflow coherence matters more than raw feature count.

## 13. The OCI chapter: infrastructure as a learning path, not just hosting

The OCI notes reveal another important part of the project's evolution: infrastructure work became a deliberate learning discipline.

The OCI process was documented stage by stage:

- understand target architecture first
- harden host baseline
- deploy runtime and validate canary behavior
- introduce load balancer only after app stability
- add WAF only after the path is known-good
- keep rollback paths alive

This reflects mature operational thinking. The project learned not to stack host, runtime, network, DNS, and security changes into one giant risky move.

### Key infrastructure lesson

Change one layer at a time.

That principle appears again and again across the OCI notes and is worth preserving because it converts scary cloud work into a sequence of reversible decisions.

## 14. Critical thinking patterns that improved the project

Across the journals, some recurring habits clearly helped:

### Compare against a real benchmark

OpenBB Pro was used not as a branding reference but as a practical benchmark for:

- widget hierarchy
- table density
- category organization
- internal widget tabbing
- comparison workflows

That gave the project a concrete target instead of vague "make it better" ambitions.

### Validate across multiple symbols

A repeated instruction in later phases is to test symbols like:

- `VNM`
- `FPT`
- `TCB`
- `HPG`
- `VCI`
- `SHS`
- `BSR`
- `HUG`
- `IPA`

This matters because many bugs only show up on:

- banks versus non-banks
- illiquid tickers versus liquid ones
- symbols with sparse or malformed source history

### Prefer fallback chains over brittle purity

Instead of insisting on one ideal source, the project increasingly accepted a harder but better truth: production software often wins by choosing resilient composition over theoretical cleanliness.

### Treat docs as memory, not decoration

The `.agent` folder is full of phases, evaluations, deployment notes, and OCI journals. That documentation made it possible to preserve context across long-running work, and it is one reason the project can keep moving forward instead of repeating old mistakes.

## 15. Obstacles that shaped the product the most

If the project had to summarize its biggest recurring obstacles, they would be:

1. data inconsistency across providers
2. financial semantics that differ by issuer type, especially banks
3. runtime and deployment complexity in real production environments
4. the temptation to add features faster than workflow clarity improves
5. the challenge of keeping a dense interface readable and trustworthy

The response to those obstacles gradually improved from local patching to system-level thinking.

## 16. What the project has accomplished so far

From the current state, the most meaningful progress is not any single widget. It is the combination of:

- a serious monorepo foundation
- a large and growing widget ecosystem
- strong movement toward OpenBB-style parity
- bank-aware domain modeling
- a more resilient backend and deployment story
- a planning process mature enough to break work into focused phases

That is a lot of ground covered. The app is no longer just a promising prototype. It is an evolving platform with a visible product philosophy.

## 17. What remains unfinished

The journal would be incomplete if it implied the product is already fully coherent. It is not.

The current frontier is workflow refinement:

- fewer fragmented surfaces
- better global symbol behavior
- stronger comparison ergonomics
- richer table affordances
- even tighter parity where OpenBB has cleaner interaction patterns

There is also a continuing operational frontier:

- keeping provider instability from leaking into the UX
- tuning caches and fallbacks without making data feel stale
- keeping deployments boring and observable

## 18. Final reflection

The most encouraging part of VNIBB's trajectory is that the project has become more disciplined over time.

Early on, the main challenge was building enough product surface area.

Now the challenge is higher quality:

- making numbers more trustworthy
- making workflows more coherent
- making infrastructure safer
- making the UI teach as well as display

That is the kind of problem a real product earns after surviving the first wave of implementation chaos.

The next stage should continue in the same spirit:

- preserve evidence-driven debugging
- keep benchmarking against serious products
- stay honest about local-market edge cases
- and keep turning a broad widget collection into a genuinely excellent research workflow

## 19. Auto-update maturity: from scheduled placeholders to an actual operating model

One of the more important operational realizations came later, after the database and Appwrite work became more serious: having sync methods is not the same thing as having a real automatic update strategy.

The backend already had scheduled jobs, but the coverage was uneven.

Some datasets were on a real schedule:

- daily prices
- indices
- screener snapshots
- financial statements and ratios
- daily trading flow

But some important vnstock-backed company datasets were still outside the automatic path:

- shareholders
- officers
- subsidiaries
- broader company news refresh

There was also an awkward mismatch between intention and reality: the intraday scheduler existed, but it was effectively a placeholder. That meant the codebase looked more automated than it really was.

The next maturity step was to stop thinking about scheduling as a binary question of "is there a cron?" and start thinking in operating-budget terms.

The actual constraint was not just time. It was provider economics.

With vnstock Golden access, the practical question became:

- which datasets truly need trading-hours freshness
- which ones can wait until after close
- which ones should rotate overnight or on weekends
- and how much of the system can be derived from local storage instead of constantly refetching providers

That led to a more disciplined model:

- market-sensitive data during trading hours on a smaller priority universe
- end-of-day and after-close refreshes for price, index, and trading datasets
- rotating off-hours updates for slower-changing company-level surfaces
- Appwrite mirroring for the tables the runtime actually depends on

This was an important conceptual shift. The system stopped being a pile of sync methods and became closer to a real operating policy.

The implementation work reflected that shift in a few concrete ways:

- the intraday scheduler was upgraded from a placeholder into a limited market-hours refresh job
- a nightly supplemental vnstock job was added for company-level datasets that were not previously on the automatic path
- scheduled jobs were tightened so they also mirror the relevant runtime tables into Appwrite instead of only updating SQL
- rate-budget thinking became part of the product architecture, not just an afterthought

That matters because freshness is not only an infrastructure concern. In a research product, freshness shapes trust.

Users do not care whether a stale number came from a scheduler omission, an Appwrite mirror gap, or a provider budget decision. They only experience it as a product that feels current or a product that feels behind.

This phase was therefore less glamorous than new widget work, but strategically important. It moved VNIBB closer to behaving like an operations-aware market platform rather than a collection of sync utilities with a UI attached.

## 20. Appwrite quota pressure forced a more honest runtime split

Another useful operational lesson arrived when Appwrite writes became the limiting factor instead of vnstock calls or frontend bugs.

That kind of pressure is clarifying because it reveals which parts of the system are truly essential and which parts were still carrying migration-era assumptions.

The most important realization was simple:

- Appwrite had become too expensive to treat as the live write target for everything
- but VNIBB did not actually need Appwrite to keep the product working day to day

The codebase already had most of the ingredients for a better emergency posture:

- Supabase/Postgres already held the durable market-data tables
- Redis already handled hot cache responsibilities
- the dashboard UI already saved locally in the browser
- and Supabase auth was already available for production login

What was missing was not a new platform. It was a cleaner statement of system ownership.

The mitigation that followed was intentionally conservative:

- keep `Supabase` as the auth provider
- make `Postgres/Supabase` the durable primary source for runtime data
- keep dashboards local-first so the UI never blocks on cloud writes
- reconcile new local dashboards into SQL after save instead of requiring them to start life with a remote ID
- freeze Appwrite writes and treat Appwrite as a legacy read fallback or future projection target only

That change mattered for more than just cost control.

It removed a hidden failure mode where users could believe they had "saved" their work while new custom dashboards were still stuck in browser-only IDs that never made it into durable storage.

It also led to a more sensible startup rule for dashboard hydration:

- if a browser already has custom local dashboards, preserve them
- if a browser is effectively fresh and only contains the built-in system dashboards, pull the durable dashboards from SQL

This was a better fit for the actual product than an Appwrite-first runtime.

During earnings season, the system does not need architectural purity. It needs dependable behavior under pressure.

The resulting operating model is clearer:

- browser state for immediate dashboard resilience
- SQL for durable user state and market data
- vnstock for freshness and gap-fill
- Appwrite only where it still provides value without being allowed to block the month

That is a healthier split because it matches the economics of the tools instead of pretending all persistence layers should be treated equally.
