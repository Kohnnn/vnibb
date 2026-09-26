import React from 'react';
import { withInjectedWidgetProps, type InjectedWidgetProps } from './widgetChildProps';

const injected: InjectedWidgetProps = {
    id: 'w1', symbol: 'MXA', widgetGroup: 'global', onDataChange: () => undefined,
};

function propsOf(element: unknown): Record<string, unknown> {
    return (element as { props: Record<string, unknown> }).props;
}

describe('withInjectedWidgetProps', () => {
    it('injects only the contract props onto a host element', () => {
        const out = withInjectedWidgetProps(React.createElement('div', { className: 'x' }), injected);
        const props = propsOf(out);
        expect(props.id).toBe('w1');
        expect(props.symbol).toBe('MXA');
        expect(props.widgetGroup).toBeUndefined();
        expect(props.onDataChange).toBeUndefined();
    });

    it('injects full props into an unresolved lazy component slot', () => {
        const Lazy = React.lazy(async () => ({ default: () => null }));
        const out = withInjectedWidgetProps(React.createElement(Lazy, {}), injected);
        const props = propsOf(out);
        expect(props.widgetGroup).toBe('global');
        expect(props.onDataChange).toBe(injected.onDataChange);
    });

    it('injects full props into a component that destructures them', () => {
        const Declares = ({ widgetGroup, onDataChange }: { widgetGroup?: string; onDataChange?: (d: unknown) => void }) =>
            React.createElement('div', null, widgetGroup, typeof onDataChange);
        const out = withInjectedWidgetProps(React.createElement(Declares, {}), injected);
        const props = propsOf(out);
        expect(props.widgetGroup).toBe('global');
        expect(props.onDataChange).toBe(injected.onDataChange);
    });

    it('drops optional props for a component that does not declare them', () => {
        const Silent = (_p: { id?: string; symbol?: string }) => React.createElement('div', null, 'x');
        const out = withInjectedWidgetProps(React.createElement(Silent, {}), injected);
        const props = propsOf(out);
        expect(props.id).toBe('w1');
        expect(props.symbol).toBe('MXA');
        expect(props.widgetGroup).toBeUndefined();
        expect(props.onDataChange).toBeUndefined();
    });

    it('does not false-positive when only the body mentions the prop', () => {
        // Body reads p.widgetGroup but the parameter list does not destructure it.
        const BodyOnly = (p: Record<string, unknown>) => React.createElement('div', null, String(p.widgetGroup));
        const out = withInjectedWidgetProps(React.createElement(BodyOnly, {}), injected);
        expect(propsOf(out).widgetGroup).toBeUndefined();
    });

    it('unwraps memo to detect declared props', () => {
        const Inner = ({ onDataChange }: { onDataChange?: (d: unknown) => void }) => React.createElement('div', null, typeof onDataChange);
        const out = withInjectedWidgetProps(React.createElement(React.memo(Inner), {}), injected);
        expect(propsOf(out).onDataChange).toBe(injected.onDataChange);
    });

    it('unwraps forwardRef to detect declared props', () => {
        const Inner = ({ widgetGroup }: { widgetGroup?: string }, _ref: unknown) => React.createElement('div', null, widgetGroup);
        const out = withInjectedWidgetProps(React.createElement(React.forwardRef(Inner), {}), injected);
        expect(propsOf(out).widgetGroup).toBe('global');
    });

    it('passes through non-elements untouched', () => {
        expect(withInjectedWidgetProps(null, injected)).toBeNull();
        expect(withInjectedWidgetProps('text', injected)).toBe('text');
    });
});
