# Error Handling & Loading States

## Overview
Comprehensive error handling and loading state infrastructure for all widgets.

## Components Created

### 1. **widget-skeleton.tsx**
Standardized skeleton loaders for consistent loading UX:
- `WidgetSkeleton` - Default animated placeholder (configurable lines)
- `TableSkeleton` - Table-specific skeleton with header and rows
- `ChartSkeleton` - Chart-specific with bar visualization
- `CompactSkeleton` - Small widget/card skeleton

**Usage:**
```tsx
{isLoading && <TableSkeleton rows={10} />}
{isLoading && <WidgetSkeleton variant="chart" />}
```

### 2. **widget-states.tsx**
Reusable error, empty, and offline state components:
- `WidgetError` - Displays error with user-friendly message + retry
- `WidgetEmpty` - Empty state with optional action button
- `OfflineIndicator` - Network offline indicator
- `CompactError` - Compact error for small widgets
- `NetworkStatus` - Online/offline badge
- `getUserFriendlyErrorMessage()` - Converts technical errors to user messages

**Usage:**
```tsx
{error && (
  <WidgetError 
    error={error as Error} 
    onRetry={() => refetch()} 
    title="Failed to load data"
  />
)}

{!data && (
  <WidgetEmpty 
    message="No data available" 
    action={{ label: 'Refresh', onClick: refetch }}
  />
)}
```

### 3. **useNetworkStatus.ts**
Hooks for network and rate limit detection:
- `useOnlineStatus()` - Real-time online/offline detection
- `useRateLimitDetection()` - Rate limit state management

### 4. **Enhanced API Layer (api.ts)**
- **APIError Class**: Structured errors with status code and statusText
- **30s Timeout**: Prevents hung requests
- **Network Detection**: Checks `navigator.onLine` before requests
- **HTTP Status Mapping**: User-friendly messages for 401, 403, 404, 429, 5xx
- **Automatic Retry**: Handled by TanStack Query (3 attempts, exponential backoff)

### 5. **QueryClient Configuration**
- **Retry Strategy**: 3 attempts with exponential backoff (1s, 2s, 4s, cap 30s)
- **Network Mode**: Only runs queries when online
- **Mutations**: 1 retry for state-changing operations

## Widget Implementation Pattern

See `ExampleErrorHandling.tsx` for complete reference. All widgets should follow:

```tsx
export function MyWidget({ symbol }: Props) {
  // 1. Fetch data
  const { data, isLoading, error, refetch } = useMyQuery(symbol);

  // 2. Loading state
  if (isLoading) {
    return <TableSkeleton rows={5} />;
  }

  // 3. Error state
  if (error) {
    return (
      <WidgetError
        error={error as Error}
        onRetry={() => refetch()}
      />
    );
  }

  // 4. Empty state
  if (!data) {
    return <WidgetEmpty message="No data" />;
  }

  // 5. Success state
  return <div>{/* Render data */}</div>;
}
```

## Error Message Translation

Technical errors are automatically translated to user-friendly messages:
- `fetch failed` → "Unable to connect to the server..."
- `timeout` → "Request took too long..."
- `400-404` → Specific client error messages
- `429` → "Too many requests..."
- `500-503` → "Server error..." / "Service unavailable..."

## What Each Layer Handles

| Layer | Responsibility |
|-------|----------------|
| **TanStack Query** | Retry logic, caching, network mode, request deduplication |
| **ErrorBoundary** | React component errors, rendering failures |
| **APIError** | HTTP errors, timeouts, network failures |
| **Widget Components** | Display errors, loading, empty states with retry |

## Migration Checklist for Existing Widgets

1. ✅ Import skeleton and state components
2. ✅ Replace inline loading spinners with `WidgetSkeleton` / `TableSkeleton`
3. ✅ Replace custom error UI with `WidgetError`
4. ✅ Replace custom empty states with `WidgetEmpty`
5. ✅ Use `error` instead of `isError` from useQuery
6. ✅ Provide `refetch` callback to retry actions
7. ✅ Remove lucide-react icons (AlertCircle, RefreshCw) if only used for errors

## Example Migration

**Before:**
```tsx
if (isError) {
  return (
    <div className="flex flex-col items-center...">
      <AlertCircle size={24} />
      <p>Failed to load</p>
      <button onClick={() => refetch()}>Retry</button>
    </div>
  );
}
```

**After:**
```tsx
if (error) {
  return <WidgetError error={error as Error} onRetry={() => refetch()} />;
}
```

## Testing Error States

To test error handling:
1. **Network Errors**: Turn off backend server
2. **Timeouts**: Add delay to API endpoint > 30s
3. **404 Errors**: Request non-existent symbol
4. **500 Errors**: Trigger backend crash
5. **Rate Limiting**: Make rapid consecutive requests
6. **Offline**: Toggle browser DevTools offline mode

All errors should:
- Show user-friendly message
- Provide retry button
- Log to console for debugging
- Auto-retry 3 times before showing error

## Production Considerations

- ✅ No uncaught errors in console
- ✅ All widgets show skeleton during loading
- ✅ All errors show friendly messages
- ✅ Retry mechanism works on all widgets
- ✅ Network offline is detected
- ✅ Timeout prevents hung requests
- ✅ Rate limiting is communicated clearly
