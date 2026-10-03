'use client';

import { getWidgetCapabilities, validateWidgetCapabilityConfiguration } from '@/data/widgetDefinitions';

interface WidgetCapabilityPanelProps {
    widgetType: string;
    symbol?: string;
    config?: Record<string, unknown>;
    onClose: () => void;
}

export function WidgetCapabilityPanel({ widgetType, symbol, config, onClose }: WidgetCapabilityPanelProps) {
    const capability = getWidgetCapabilities(widgetType);
    const configuration = capability ? validateWidgetCapabilityConfiguration(capability, config) : null;

    return (
        <section aria-label="Widget requirements and limitations" className="shrink-0 max-h-72 overflow-y-auto border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-3 text-xs leading-5 text-[var(--text-secondary)]">
            <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold text-[var(--text-primary)]">Requirements &amp; limitations</h3>
                <button type="button" onClick={onClose} aria-label="Close widget requirements" className="rounded px-2 py-1 text-[var(--text-primary)] hover:bg-[var(--bg-hover)]">Close</button>
            </div>
            {!capability ? <p>No valid catalogue widget was selected. No widget-specific VniAgent coverage is declared.</p> : <>
                <p className="mt-2">{capability.description}</p>
                <p className="mt-2"><strong>Scope: </strong>{capability.scope}. {capability.symbolRequirement}</p>
                {capability.scope === 'symbol' && <p><strong>Current ticker: </strong>{symbol || 'Missing — select a widget ticker before analysis.'}</p>}
                <p><strong>VniAgent coverage: </strong>{capability.coverage === 'mapped' ? capability.evidenceKinds.join(', ') : 'Not mapped; no evidence coverage claimed.'}</p>
                <h4 className="mt-2 font-semibold text-[var(--text-primary)]">Reviewed configuration inputs</h4>
                {capability.configurationInputs.length ? <ul className="list-disc pl-4">
                    {capability.configurationInputs.map(input => <li key={input.key}>
                        <strong>{input.label}: </strong>{input.values.join(', ')}. {input.description}
                        {' '}Current: {configuration?.values[input.key] || `not validated (default ${input.defaultValue})`}.
                    </li>)}
                </ul> : <p>No supported configuration inputs are declared for VniAgent. Use the widget’s own controls; do not assume they change agent evidence.</p>}
                {!!configuration?.invalidKeys.length && <p role="status">Invalid configuration excluded from capability context: {configuration.invalidKeys.join(', ')}.</p>}
                <h4 className="mt-2 font-semibold text-[var(--text-primary)]">Evidence limits</h4>
                <ul className="list-disc pl-4">{capability.evidenceLimits.map(limit => <li key={limit}>{limit}</li>)}</ul>
            </>}
        </section>
    );
}
