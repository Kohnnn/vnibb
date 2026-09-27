/**
 * @jest-environment jsdom
 */
import {
  buildArtifactProvenance,
  readArtifactProvenance,
  recordArtifactProvenance,
  readArtifactWidgetProvenanceIndex,
  rememberArtifactPlacement,
  readArtifactPlacement,
  findArtifactWidgetResponseId,
  ARTIFACT_WIDGET_PROVENANCE_KEY,
} from '@/lib/copilotArtifactProvenance';

describe('P5 wire-path closure: provenance travels and the badge resolves', () => {
  beforeEach(() => localStorage.clear());

  it('stamps a marker onto widget config that survives JSON round-trip', () => {
    const cfg = buildArtifactProvenance({
      artifactId: 'comparison_snapshot',
      responseId: 'resp-abc',
      artifactType: 'table',
      artifactTitle: 'Comparison Snapshot',
      dashboardId: 'dash-1',
      tabId: 'tab-2',
      destination: 'My Workspace / Fundamentals',
    });
    expect(cfg[ARTIFACT_WIDGET_PROVENANCE_KEY]).toBeDefined();
    // Simulate persistence through localStorage/JSON exactly as the app does
    const revived = JSON.parse(JSON.stringify(cfg));
    const read = readArtifactProvenance(revived as never);
    expect(read).toMatchObject({
      artifactId: 'comparison_snapshot',
      responseId: 'resp-abc',
      artifactType: 'table',
      destination: 'My Workspace / Fundamentals',
    });
    expect(read?.createdAt).toBeTruthy();
  });

  it('rejects a config with no marker (unrelated widget)', () => {
    expect(readArtifactProvenance({ symbol: 'FPT' } as never)).toBeNull();
    expect(readArtifactProvenance(null)).toBeNull();
  });

  it('rejects a partial marker so the badge cannot render fabricated state', () => {
    expect(readArtifactProvenance({ [ARTIFACT_WIDGET_PROVENANCE_KEY]: { artifactId: 'x' } } as never)).toBeNull();
  });

  it('badge label resolution: restored promotion yields the same label as live', () => {
    const provenance = buildArtifactProvenance({
      artifactId: 'foreign_flow_leaderboard',
      responseId: 'resp-xyz',
      artifactType: 'table',
      artifactTitle: 'Foreign Flow Leaderboard',
      dashboardId: 'dash-9',
      tabId: 'tab-1',
      destination: 'My Workspace / Flow',
    });
    const read = readArtifactProvenance(provenance as never)!;
    // Panel logic: addedToLabel = promotedPlacement?.label || promotedWidget.label || 'personal workspace'
    const destinations = [{ dashboardId: 'dash-9', tabId: 'tab-1', label: 'My Workspace / Flow' }];
    const promotedPlacement = destinations.find(
      (d) => d.dashboardId === read.dashboardId && d.tabId === read.tabId,
    );
    const addedToLabel = promotedPlacement?.label || read.destination || 'personal workspace';
    expect(addedToLabel).toBe('My Workspace / Flow');
  });

  it('badge falls back to the widget marker when the tab was since deleted', () => {
    const provenance = buildArtifactProvenance({
      artifactId: 'price_trend_chart', responseId: 'r2', artifactType: 'chart',
      artifactTitle: 'Price Trend', dashboardId: 'gone', tabId: 'gone',
      destination: 'Deleted Board / Old Tab',
    });
    const read = readArtifactProvenance(provenance as never)!;
    const destinations: { dashboardId: string; tabId: string; label: string }[] = [];
    const promotedPlacement = destinations.find(
      (d) => d.dashboardId === read.dashboardId && d.tabId === read.tabId,
    );
    expect(promotedPlacement).toBeUndefined();
    expect(promotedPlacement?.label || read.destination || 'personal workspace').toBe('Deleted Board / Old Tab');
  });

  it('device-local index restores badge state across a reload', () => {
    const provenance = buildArtifactProvenance({
      artifactId: 'sector_breadth_snapshot', responseId: 'r3', artifactType: 'table',
      artifactTitle: 'Sector Breadth', dashboardId: 'd1', tabId: 't1',
      destination: 'My Workspace / Market',
    });
    recordArtifactProvenance('widget-77', readArtifactProvenance(provenance as never)!);
    const index = readArtifactWidgetProvenanceIndex();
    expect(index['widget-77']).toMatchObject({ artifactId: 'sector_breadth_snapshot', responseId: 'r3' });
    // findArtifactWidgetResponseId is what the panel uses to restore
    expect(findArtifactWidgetResponseId('widget-77')).toBe('r3');
    expect(findArtifactWidgetResponseId('unknown-widget')).toBeUndefined();
  });

  it('placement memory persists and drives the default destination', () => {
    expect(readArtifactPlacement()).toBeNull();
    rememberArtifactPlacement('dash-A', 'tab-B', 'Board A / Flow');
    const stored = readArtifactPlacement();
    expect(stored).toMatchObject({ dashboardId: 'dash-A', tabId: 'tab-B', label: 'Board A / Flow' });
  });
});
