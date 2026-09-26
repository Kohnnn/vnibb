import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';

/**
 * Props WidgetWrapper injects into a widget child.
 *
 * `id` and `symbol` are part of the documented `WidgetProps` contract and are
 * consumed by essentially every widget. `widgetGroup` and `onDataChange` are
 * optional, and `onDataChange` is the wrapper's runtime-data channel
 * (`setInternalData`), which drives export payloads and layout hints.
 */
export interface InjectedWidgetProps {
  id?: string;
  symbol?: string;
  widgetGroup?: string;
  onDataChange?: (data: unknown) => void;
}

const OPTIONAL_PROP_NAMES = ['widgetGroup', 'onDataChange'] as const;

/**
 * Inject wrapper props into a widget child without leaking them onto DOM nodes.
 *
 * Why this exists: DashboardClient renders a lazy widget as the child of
 * WidgetWrapper (`<LazyWidgetComponent … />`). React resolves that element to the
 * widget's outermost host element before the widget's own function ever runs, so a
 * blanket `cloneElement(child, { widgetGroup, onDataChange })` ends up spreading
 * wrapper-only props onto whatever DOM node the widget renders — producing
 * "React does not recognize the `widgetGroup` prop on a DOM element" and
 * "Unknown event handler property `onDataChange`," and silently breaking the
 * runtime-data channel for those widgets.
 *
 * `id` and `symbol` are always injected: they are the documented WidgetProps
 * contract. `widgetGroup` and `onDataChange` are injected only when the target is
 * a component slot that is known or expected to consume them.
 */
export function withInjectedWidgetProps(
  child: ReactNode,
  props: InjectedWidgetProps,
): ReactNode {
  if (!isValidElement(child)) return child;

  const targetType = (child as ReactElement<unknown>).type as unknown;
  // A lazy (or otherwise unresolved) component slot is never a host element, so the
  // extra props cannot reach the DOM through it; the widget consumes or ignores them.
  const isUnresolvedComponentSlot =
    targetType !== null && typeof targetType === 'object' && '$$typeof' in (targetType as object);

  const injected: InjectedWidgetProps =
    isUnresolvedComponentSlot || acceptsOptionalProps(targetType)
      ? { ...props }
      : { id: props.id, symbol: props.symbol };

  return cloneElement(
    child as ReactElement<Record<string, unknown>>,
    injected as Record<string, unknown>,
  );
}

/**
 * Detect whether a *resolved* component declares `widgetGroup` or `onDataChange`.
 *
 * Only the parameter list is inspected. Compiled function bodies reference props as
 * `p.widgetGroup` regardless of what the component declares, so scanning the whole
 * source produces false positives; the parameter list cannot.
 */
function acceptsOptionalProps(type: unknown): boolean {
  const params = componentParameterSource(type);
  if (!params) return false;
  return OPTIONAL_PROP_NAMES.some((prop) => new RegExp(`\\b${prop}\\b`).test(params));
}

function componentParameterSource(type: unknown): string | null {
  const fn = resolveComponentFunction(type);
  if (!fn) return null;

  const source = Function.prototype.toString.call(fn);
  const arrowAt = source.indexOf('=>');
  if (arrowAt !== -1) {
    return source.slice(0, arrowAt);
  }

  const openParen = source.indexOf('(');
  const closeParen = source.indexOf(')', openParen);
  if (openParen !== -1 && closeParen > openParen) {
    return source.slice(openParen, closeParen);
  }

  return null;
}

function resolveComponentFunction(type: unknown): ((...args: never[]) => unknown) | null {
  if (typeof type === 'function') return type as (...args: never[]) => unknown;

  if (type && typeof type === 'object') {
    const record = type as Record<string, unknown>;
    const inner = record.render ?? record.type;
    if (typeof inner === 'function') return inner as (...args: never[]) => unknown;
    if (inner && typeof inner === 'object') {
      const deep = (inner as Record<string, unknown>).render ?? (inner as Record<string, unknown>).type;
      if (typeof deep === 'function') return deep as (...args: never[]) => unknown;
    }
  }

  return null;
}
