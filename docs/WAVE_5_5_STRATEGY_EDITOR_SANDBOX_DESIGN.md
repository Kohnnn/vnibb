# Wave 5.5 Strategy Editor Sandbox — Design

Date: 2026-06-24
Status: design only, not implemented

## Scope

This document defines the security design for a future strategy code editor and backtest IDE in VNIBB. It does not approve implementation. Wave 5.5 is intentionally limited to architecture, threat boundaries, and launch gates because arbitrary user-code execution is the largest security surface in the quant roadmap.

In scope:

- A future dashboard widget for strategy authoring in `apps/web`.
- A future backend submission surface in `apps/api` only after the gates in this document are answered.
- A staged rollout that starts with non-executable templates and a signed parameterized DSL before any sandboxed execution.
- Security boundaries for any eventual execution runtime.
- Audit, rate-limit, resource-budget, and data-access requirements.

Out of scope for this wave:

- Implementing the editor widget.
- Implementing sandbox execution.
- Client-side execution using `eval`, `Function`, `new Function`, string timers, or WebAssembly plugins in the main app.
- Arbitrary Python execution inside the FastAPI process.
- Enabling Appwrite writes or durable strategy storage.
- Live trading, paper trading execution, strategy marketplace, or strategy sharing.

## Non-Goals

| Non-goal | Reason |
| --- | --- |
| General-purpose Python notebook | Too broad; every package/import expands the escape surface. |
| Full backtesting engine | Existing quant routes have bounded, fixed algorithms. User-authored strategies need a separate safety model. |
| Persistent user code | Durable writes cross the Appwrite-primary bridge, which remains frozen by default. |
| Client-side code execution | Browser execution would make XSS and data exfiltration harder to contain. |
| In-process backend execution | A sandbox escape would become API-host compromise. |
| Multi-tenant hardening by assumption | Must be proven by runtime isolation, not asserted. |

## Repository Context

VNIBB is a monorepo:

- Frontend: `apps/web`, Next.js app router dashboard and widgets.
- Backend: `apps/api`, FastAPI routers under `apps/api/vnibb/api/v1`.
- Quant surface: `apps/api/vnibb/api/v1/quant.py`.
- Market surface: `apps/api/vnibb/api/v1/market.py`.
- Runtime data model: Appwrite-primary with PostgreSQL/Supabase fallback/bridge; writes are frozen by default and must not be changed by this wave.
- Existing quant/backtest routes are fixed-algorithm endpoints, not arbitrary execution surfaces.

## Assumptions

| Assumption | Effect if wrong |
| --- | --- |
| User-authenticated dashboard is the only intended entry point. | Public unauthenticated access would raise every sandbox threat to high/critical. |
| Initial design can start with templates/DSL before arbitrary code. | If arbitrary code is required from day one, Stage 3 gates become mandatory first. |
| Market data needed for strategy evaluation can be pre-baked by the API. | If workers need dynamic reads, a scoped read-only data API and token model are required. |
| Appwrite writes remain disabled. | Durable strategy persistence becomes a separate write-bridge project. |
| No deployed job queue exists for user workloads. | Sandbox execution cannot be safely synchronous in the API request path. |

## Trust Boundaries

```text
Browser dashboard (apps/web)
  | HTTPS + auth token
  v
FastAPI API boundary (apps/api)
  | validates strategy schema, budgets, auth, audit metadata
  v
Isolated sandbox worker (future Stage 3 only)
  | no secrets, no filesystem writes, no network egress by default
  v
Pre-baked read-only market data payload
```

Boundary requirements:

| Boundary | Required controls |
| --- | --- |
| Browser to API | HTTPS, auth, CSRF/CORS posture preserved, JSON schema validation, request-size limit, rate limit. |
| API to worker | Internal-only job boundary, short-lived job token if needed, no DB credentials or app secrets passed to worker. |
| Worker to data | Prefer pre-baked immutable OHLCV payload. If dynamic reads are required, use scoped read-only endpoint limited to one job/symbol/date window. |
| Worker to network | Deny egress by default. No outbound Internet. |
| Worker to filesystem | Read-only rootfs, no project source mount, no `.env`, no `/proc/self/environ`, no writable shared volume. |
| Worker to logs/audit | Worker cannot write or mutate audit logs directly; API records append-only events. |

## Assets

| Asset | Location | Sensitivity | Why it matters |
| --- | --- | --- | --- |
| User session token | Browser and API request headers | High | Allows API access as the user. |
| Strategy source/DSL | Browser memory, transient API request | Medium | User intellectual property; may accidentally contain secrets. |
| Market data payload | API response, sandbox memory | Medium | Public-ish data, commercially valuable in bulk. |
| Database credentials | API process environment | Critical | Sandbox escape must not expose them. |
| vnstock/API provider keys | API process environment | High | Provider quota and premium-data access. |
| Appwrite/admin credentials | API process environment | Critical | Write freeze and admin operations depend on isolation. |
| Sandbox compute budget | Worker host/container | High | Resource abuse can degrade API availability. |
| Audit log | API-side logs/table | Medium | Needed for investigation and abuse response. |

## Attacker Capabilities

Assume an attacker can:

- Authenticate as a normal user.
- Submit arbitrary text to any future strategy endpoint.
- Send repeated HTTP requests up to rate limits.
- Attempt CPU, memory, and output-size exhaustion.
- Attempt sandbox escape using Python runtime features, imports, serialization, or library edge cases.
- Attempt data exfiltration through output encoding.

Assume an attacker cannot:

- Access API host files before sandbox escape.
- Reach the database or MongoDB directly.
- Toggle Appwrite writes or admin configuration through normal user APIs.
- Access another user’s browser session without a separate web vulnerability.

## Abuse Paths

| ID | Abuse path | Impact | Likelihood | Priority |
| --- | --- | --- | --- | --- |
| T1 | Sandbox escape executes host commands or reads environment secrets. | API host compromise, credential theft. | Medium if arbitrary Python exists. | Critical |
| T2 | Network egress sends secrets or data to attacker infrastructure. | Data and credential exfiltration. | Medium without network deny. | High |
| T3 | Infinite loop, huge allocation, or fork bomb exhausts CPU/memory. | API degradation or outage. | High. | High |
| T4 | Filesystem reads expose `.env`, source, tokens, or `/proc`. | Credential leakage. | Medium without filesystem isolation. | High |
| T5 | Strategy output injects HTML/script into the dashboard. | XSS, token theft. | Medium if output renderer is unsafe. | High |
| T6 | High-volume submissions scrape market data beyond intended budget. | Quota/cost abuse and service degradation. | Medium. | Medium |
| T7 | Audit tampering hides abusive submissions. | Incident response blind spot. | Low if API owns audit writes. | Medium |
| T8 | Prompt injection in strategy comments targets future AI review. | Bad AI guidance or unsafe code suggestions. | Low until AI is connected. | Low/deferred |

## Staged Rollout

### Stage 1 — Templates only, no execution

- Frontend shows a catalog of fixed strategy templates such as moving-average crossover or RSI threshold.
- Users change bounded parameters through form controls, not code.
- Any computation calls existing fixed-algorithm quant/backtest endpoints.
- No sandbox runtime.
- No new durable writes.

Exit criteria:

- Template parameters are schema-validated.
- Output renderer escapes all text.
- Feature flag is off by default.

### Stage 2 — Signed parameterized DSL

- Add a bounded strategy schema: indicators, comparisons, entry/exit rules, and risk controls.
- No loops, recursion, imports, filesystem, network, package installation, or arbitrary expressions.
- Server validates and signs accepted strategy JSON before execution by fixed interpreters.
- Execution still uses reviewed backend functions, not user code.

Exit criteria:

- Pydantic boundary model reviewed.
- Strategy schema has explicit maximums for symbols, rows, indicators, and rule count.
- Signed payload cannot be widened by client tampering.

### Stage 3 — Isolated sandbox execution, only if still needed

If actual user code is still required after Stages 1–2, execution must move to an isolated worker. Minimum requirements:

- Separate process/container/microVM outside the FastAPI event loop.
- Non-root user.
- No API secrets mounted.
- Read-only root filesystem.
- No outbound network by default.
- CPU quota, memory limit, process count limit, and wall-clock timeout.
- Output size cap.
- Pre-baked market data payload preferred over worker database access.
- Append-only API-owned audit log.
- Async job boundary: submit returns `job_id`; request handler never blocks on long-running code.

Do not implement Stage 3 until the open questions are answered and a security review approves the runtime.

## Recommended Runtime Options for Stage 3

| Option | Pros | Cons | Recommendation |
| --- | --- | --- | --- |
| Pre-baked DSL interpreter | No arbitrary code; easiest to review. | Less flexible than Python snippets. | Preferred first. |
| Isolated container worker | Familiar deployment model; strong filesystem/network controls possible. | Requires container orchestration and careful Docker socket avoidance. | Viable if infra supports sibling workers without mounting Docker socket into API. |
| MicroVM/gVisor-style worker | Stronger isolation. | More operational complexity. | Best for multi-tenant public use. |
| WASM runtime | Capability-based; no normal syscall access. | Python/numpy support may be limited. | Long-term option, not assumed for v1. |
| API subprocess with stripped builtins | Simple. | Not enough for untrusted arbitrary Python by itself. | Not acceptable as the only boundary. |

## Mitigations

| Threat | Required mitigation |
| --- | --- |
| T1 sandbox escape | Do not run arbitrary code in the API process. Use DSL first; if needed, use isolated worker with no secrets. |
| T2 network exfiltration | Deny worker egress. Pass immutable input data from API. |
| T3 resource exhaustion | Enforce CPU, memory, process count, wall-clock, output-size, per-user, and global concurrency limits. |
| T4 filesystem read | Read-only worker root, no source/env mounts, non-root user, no shared writable volume. |
| T5 XSS through output | Render JSON/table/text through React escaping; never inject raw HTML; cap error output. |
| T6 data scraping | Limit symbols/date windows per job; rate-limit by user/IP/symbol; cache public reads separately from sandbox jobs. |
| T7 audit tampering | API writes audit events before and after execution; worker cannot mutate audit stream. |
| T8 prompt injection | Treat strategy text as untrusted if future VniAgent integration reads it; pass structured summaries, not raw code, to AI. |

## Open Questions

1. **Execution model:** Is Stage 2 DSL enough, or is arbitrary Python truly required?
2. **Sandbox runtime:** If arbitrary code is required, which isolation layer is approved: container worker, microVM/gVisor, WASM, or another runtime?
3. **Data payload:** What exact fields are passed to the worker: OHLCV only, adjusted prices, corporate actions, ratios, quant metrics?
4. **Resource budget:** What per-user and global CPU/memory/concurrency budget can the production host support?
5. **Error policy:** Should users see sanitized error codes only, or bounded stack traces without host paths/library versions?
6. **Audit destination:** Should sandbox audit events be structured logs only, or a PostgreSQL append-only table?
7. **Feature flag ownership:** Who can promote Stage 1 to Stage 2 or Stage 3?

## Do Not Build Until These Questions Are Answered

Implementation is blocked until these decisions are documented:

1. Stage choice approved: templates only, DSL, or isolated worker.
2. Runtime isolation approved if user code is required.
3. Data payload schema approved and bounded.
4. Resource limits approved by the operator.
5. Error display policy approved.
6. Audit destination approved.
7. Feature flag and rollout owner assigned.

The default implementation path should be Stage 1 templates, then Stage 2 signed DSL. Stage 3 arbitrary-code sandboxing is a separate security project, not an incremental widget task.

## Hard Rules

- No client-side `eval`, `Function`, `new Function`, string timers, or main-app WASM plugin execution.
- No arbitrary Python in the FastAPI process.
- No Appwrite write enablement.
- No database credentials, provider keys, or admin secrets inside any worker.
- No synchronous long-running sandbox execution in a request handler.
- No raw HTML rendering of strategy output.
- No implementation in Wave 5.5 until the gates above are resolved.
