'use client'

/**
 * Static, read-only catalog of the `vnibb-mcp` tool surface.
 *
 * This mirrors the documented inventory in `docs/VNIBB_MCP_READONLY.md`. It is a
 * frontend-only descriptor so VniAgent diagnostics can show users which tools the
 * agent can call and the permission class of each one. It deliberately contains
 * NO write/admin/sync tools — that is the whole point of the read-only MCP. The
 * catalog is informational; it does not itself execute anything.
 *
 * Permission taxonomy (Quantcept-inspired): every tool is classified so the UI
 * can make the read-only posture obvious.
 *   - read_only:    pure read, no auth side effects, safe for agents by default
 *   - authenticated_read: read that requires the shared bearer token on remote HTTP
 *   - confirm_action:  would mutate/side-effect — NONE exist today; reserved so the
 *                       taxonomy is ready if an admin MCP is ever added separately.
 */

export type McpPermissionClass = 'read_only' | 'authenticated_read' | 'confirm_action'

export type McpToolSource = 'app_collections' | 'analytical_corpus'

export interface McpToolDescriptor {
  name: string
  description: string
  source: McpToolSource
  permission: McpPermissionClass
  /** Example arguments, purely illustrative for the catalog UI. */
  sampleInput?: Record<string, unknown>
}

export interface McpResourceDescriptor {
  uri: string
  description: string
}

export interface McpPromptDescriptor {
  name: string
  description: string
}

export const MCP_PERMISSION_LABELS: Record<McpPermissionClass, { label: string; detail: string }> = {
  read_only: {
    label: 'Read-only',
    detail: 'Pure read. No side effects. Safe for the agent to call by default.',
  },
  authenticated_read: {
    label: 'Authenticated read',
    detail:
      'Requires an authenticated remote transport: the shared bearer token, or a verified user JWT for tools scoped to the caller\'s own data.',
  },
  confirm_action: {
    label: 'Confirm action',
    detail: 'Would mutate state — requires explicit user confirmation. None are exposed today.',
  },
}

export const MCP_TOOL_CATALOG: McpToolDescriptor[] = [
  // Bootstrap + user-scoped (no curated store of their own)
  {
    name: 'get_agent_connection_guide',
    description: 'Connection guide plus retrieval skills catalog inline, for agent self-bootstrap.',
    source: 'app_collections',
    permission: 'read_only',
  },
  {
    name: 'get_matrix_selection',
    description: "Caller's frozen Matrix selection and evidence, subject to source export rights. Requires a verified user JWT; the shared bearer is rejected.",
    source: 'app_collections',
    permission: 'authenticated_read',
  },
  // App-collection-backed (curated app collections)
  {
    name: 'list_supported_collections',
    description: 'List the curated, read-only app collections the MCP allows.',
    source: 'app_collections',
    permission: 'read_only',
  },
  {
    name: 'get_database_status',
    description: 'Report database connectivity/status for the app-collection backend.',
    source: 'app_collections',
    permission: 'read_only',
  },
  {
    name: 'get_symbol_snapshot',
    description: 'Preferred high-level snapshot for a single symbol (quote, profile, key reads).',
    source: 'app_collections',
    permission: 'read_only',
    sampleInput: { symbol: 'FPT' },
  },
  {
    name: 'get_market_snapshot',
    description: 'Preferred high-level market snapshot (indices and breadth context).',
    source: 'app_collections',
    permission: 'read_only',
  },
  {
    name: 'get_symbol_prices',
    description: 'Read recent price rows for a symbol from the curated app collection.',
    source: 'app_collections',
    permission: 'read_only',
    sampleInput: { symbol: 'VCB', limit: 30 },
  },
  {
    name: 'get_latest_financial_statement',
    description: 'Latest income statement / balance sheet / cash flow for a symbol.',
    source: 'app_collections',
    permission: 'read_only',
    sampleInput: { symbol: 'VNM' },
  },
  {
    name: 'get_latest_financial_ratios',
    description: 'Latest financial ratios for a symbol.',
    source: 'app_collections',
    permission: 'read_only',
    sampleInput: { symbol: 'VNM' },
  },
  {
    name: 'get_company_news',
    description: 'Recent company news rows for a symbol.',
    source: 'app_collections',
    permission: 'read_only',
    sampleInput: { symbol: 'HPG' },
  },
  {
    name: 'get_corporate_timeline',
    description: 'Corporate events/timeline for a symbol.',
    source: 'app_collections',
    permission: 'read_only',
    sampleInput: { symbol: 'MWG' },
  },
  {
    name: 'query_database_collection',
    description: 'Constrained generic read over allowlisted collections (max limits + filter validation).',
    source: 'app_collections',
    permission: 'read_only',
  },
  // Analytical-corpus-backed (vnstock premium analytical corpus)
  {
    name: 'get_mongo_status',
    description: 'Report status of the private analytical corpus (vnibb-market).',
    source: 'analytical_corpus',
    permission: 'authenticated_read',
  },
  {
    name: 'list_premium_datasets',
    description: 'Discover allowlisted premium dataset names and their caps.',
    source: 'analytical_corpus',
    permission: 'authenticated_read',
  },
  {
    name: 'get_eod_price_history',
    description: 'End-of-day OHLCV history from market_prices_eod (~1.3M rows).',
    source: 'analytical_corpus',
    permission: 'authenticated_read',
    sampleInput: { symbol: 'FPT', limit: 250 },
  },
  {
    name: 'get_premium_dataset',
    description: 'Read an allowlisted premium dataset, symbol-exact with full storage provenance.',
    source: 'analytical_corpus',
    permission: 'authenticated_read',
    sampleInput: { dataset: 'finance.ratio', symbol: 'VNM' },
  },
  {
    name: 'get_intraday_trades',
    description: 'Intraday trade rows for a symbol from the analytical corpus.',
    source: 'analytical_corpus',
    permission: 'authenticated_read',
    sampleInput: { symbol: 'SSI' },
  },
  {
    name: 'get_price_depth',
    description: 'Bounded price-depth levels from the newest write batch, with per-row provenance.',
    source: 'analytical_corpus',
    permission: 'authenticated_read',
    sampleInput: { symbol: 'SSI' },
  },
  {
    name: 'get_reference_dataset',
    description: 'Exact IQ profile/metric-map document from its explicit physical store.',
    source: 'analytical_corpus',
    permission: 'authenticated_read',
    sampleInput: { symbol: 'VNM', store: 'market_company_profiles' },
  },
  {
    name: 'get_ingestion_receipts',
    description: 'Bounded per-dataset acquisition receipts from SQL or Mongo; never runs ingestion.',
    source: 'analytical_corpus',
    permission: 'authenticated_read',
    sampleInput: { symbol: 'VNM', dataset: 'profiles' },
  },
]

export const MCP_RESOURCE_CATALOG: McpResourceDescriptor[] = [
  { uri: 'vnibb://mcp/guardrails', description: 'Read-only policy and guardrails statement.' },
  { uri: 'vnibb://database/collections', description: 'Allowlisted app collections.' },
  { uri: 'vnibb://mongo/datasets', description: 'Allowlisted analytical datasets.' },
  { uri: 'vnibb://database/schema/{collection}', description: 'Schema intent for an allowlisted collection.' },
  { uri: 'vnibb://mcp/guide', description: 'Connection guide: transport, auth, discovery order, read-only contract.' },
  { uri: 'vnibb://mcp/skills', description: 'Retrieval skills catalog: named workflows for recurring agent intents.' },
]

export const MCP_PROMPT_CATALOG: McpPromptDescriptor[] = [
  { name: 'symbol_deep_dive', description: 'Recurring single-symbol research workflow.' },
  { name: 'market_brief', description: 'Recurring market overview workflow.' },
  { name: 'eod_price_history', description: 'Long-horizon OHLCV history retrieval.' },
  { name: 'premium_dataset', description: 'One allowlisted vnstock premium dataset.' },
  { name: 'intraday_trades', description: 'Recent intraday tick activity for one symbol.' },
  { name: 'price_depth', description: 'Volume-at-price depth retrieval.' },
  { name: 'database_collection_audit', description: 'Audit an allowlisted collection.' },
]

/** Tools the read-only MCP intentionally does NOT expose (for the diagnostics note). */
export const MCP_EXCLUDED_CAPABILITIES: string[] = [
  'dashboard / widget / layout writes',
  'watchlist writes',
  'database writes or deletes',
  'sync / seed / backfill / refresh triggers',
  'admin data-health actions',
  'schema / index management',
]
