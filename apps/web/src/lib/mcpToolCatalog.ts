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
    detail: 'Read that requires the shared bearer token when called over remote HTTP.',
  },
  confirm_action: {
    label: 'Confirm action',
    detail: 'Would mutate state — requires explicit user confirmation. None are exposed today.',
  },
}

export const MCP_TOOL_CATALOG: McpToolDescriptor[] = [
  // App-collection-backed (curated app collections)
  {
    name: 'list_supported_collections',
    description: 'List the curated, read-only app collections the MCP allows.',
    source: 'app_collections',
    permission: 'read_only',
  },
  {
    name: 'get_appwrite_status',
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
    name: 'query_appwrite_collection',
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
    description: 'Read an allowlisted premium dataset (per-dataset max limits enforced).',
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
    description: 'Order-book/price-depth snapshot from the analytical corpus.',
    source: 'analytical_corpus',
    permission: 'authenticated_read',
    sampleInput: { symbol: 'SSI' },
  },
]

export const MCP_RESOURCE_CATALOG: McpResourceDescriptor[] = [
  { uri: 'vnibb://mcp/guardrails', description: 'Read-only policy and guardrails statement.' },
  { uri: 'vnibb://appwrite/collections', description: 'Allowlisted app collections.' },
  { uri: 'vnibb://mongo/datasets', description: 'Allowlisted analytical datasets.' },
  { uri: 'vnibb://appwrite/schema/{collection}', description: 'Schema intent for an allowlisted collection.' },
]

export const MCP_PROMPT_CATALOG: McpPromptDescriptor[] = [
  { name: 'symbol_deep_dive', description: 'Recurring single-symbol research workflow.' },
  { name: 'market_brief', description: 'Recurring market overview workflow.' },
  { name: 'appwrite_collection_audit', description: 'Audit an allowlisted collection.' },
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
