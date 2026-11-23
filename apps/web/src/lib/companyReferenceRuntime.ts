import { buildWidgetRuntime, type WidgetRuntimeInput } from './widgetRuntime';

const referenceSources = {
  officers_management: { route: 'officers', sourceLabel: 'Officers and management' },
  subsidiaries: { route: 'subsidiaries', sourceLabel: 'Subsidiaries' },
};

export type CompanyReferenceWidgetType = keyof typeof referenceSources;

export function isCompanyReferenceWidget(type: string): type is CompanyReferenceWidgetType {
  return type === 'officers_management' || type === 'subsidiaries';
}

type ReferenceState = Pick<WidgetRuntimeInput,
  'observationStatus' | 'refreshStatus' | 'lastDataDate' | 'fetchedAt' |
  'failedAt' | 'failureKind' | 'cached' | 'warnings' | 'exportData'
>;

export function buildCompanyReferenceRuntime(type: CompanyReferenceWidgetType, symbol: string, state?: ReferenceState) {
  const { route, sourceLabel } = referenceSources[type];
  return buildWidgetRuntime({
    ...state,
    empty: !symbol || state?.observationStatus === 'empty',
    apiGroup: '/equity',
    endpoint: `/api/v1/equity/${symbol || '{symbol}'}/${route}`,
    endpointKind: symbol ? undefined : 'route_summary',
    sourceLabel,
    requestScope: { widgetType: type, symbol },
    observationStatus: state?.observationStatus ?? (symbol ? 'loading' : undefined),
    coverage: 'unknown',
    fetchedAt: state?.fetchedAt ?? null,
    exportData: state?.exportData ?? null,
  });
}
