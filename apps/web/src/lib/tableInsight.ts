export type TableSelectionKind = 'row' | 'column';

/** A user's selection inside a dense financial table. */
export interface TableSelection {
  kind: TableSelectionKind;
  /** Row id (a period) or column key (a metric). */
  key: string;
}

export const NO_SELECTION: TableSelection | null = null;

export type SeriesKind = 'currency' | 'percent' | 'number' | 'text';

/** A table column reduced to what a chart and the copilot need. */
export interface ColumnSeries {
  key: string;
  label: string;
  kind: SeriesKind;
}

export interface ChartableColumn {
  key: string;
  label: string;
  kind?: SeriesKind;
  /** Period columns (2024, Q1, TTM) are rows to chart against, not series. */
  isPeriod?: boolean;
}

/**
 * The columns that can be charted as a series. Period columns are excluded:
 * they are the x-axis, never a series, which is what keeps a selection from
 * silently charting a year against a metric.
 */
export function selectableSeries(columns: readonly ChartableColumn[]): ColumnSeries[] {
  return columns
    .filter((column) => !column.isPeriod && (column.kind ?? 'number') !== 'text')
    .map((column) => ({ key: column.key, label: column.label, kind: column.kind ?? 'number' }));
}

/** Click selects; clicking the same key again clears. A different kind replaces. */
export function toggleSelection(current: TableSelection | null, next: TableSelection): TableSelection | null {
  if (current && current.kind === next.kind && current.key === next.key) return null;
  return next;
}

/** The resolved series for a selection: a column charts itself, a row charts all numeric columns. */
export function seriesFromSelection(
  columns: readonly ChartableColumn[],
  selection: TableSelection | null,
): ColumnSeries[] {
  const series = selectableSeries(columns);
  if (!selection) return series;
  if (selection.kind === 'column') return series.filter((entry) => entry.key === selection.key);
  return series;
}

/** One-line label for the chart header and the copilot context. */
export function describeSelection(
  selection: TableSelection | null,
  columns: readonly ChartableColumn[],
  rowLabel?: string,
): string {
  if (!selection) return 'All metrics';
  if (selection.kind === 'column') {
    return columns.find((column) => column.key === selection.key)?.label ?? selection.key;
  }
  return rowLabel ? `Period ${rowLabel}` : `Period ${selection.key}`;
}

export interface TableInsightContext {
  focus: string;
  series: ColumnSeries[];
  rowKey: string | null;
  columnKey: string | null;
}

/** The payload a widget hands the copilot so a question can target the selection. */
export function buildTableInsightContext(args: {
  selection: TableSelection | null;
  columns: readonly ChartableColumn[];
  rowLabel?: string;
}): TableInsightContext {
  const { selection, columns, rowLabel } = args;
  return {
    focus: describeSelection(selection, columns, rowLabel),
    series: seriesFromSelection(columns, selection),
    rowKey: selection?.kind === 'row' ? selection.key : null,
    columnKey: selection?.kind === 'column' ? selection.key : null,
  };
}
