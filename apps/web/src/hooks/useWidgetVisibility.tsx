// Widget visibility hook with single IntersectionObserver at grid level
// Optimizes from 50+ observers to ~1 observer per grid

'use client';

import { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo, type ReactNode } from 'react';

// ============ Types ============

export interface WidgetVisibilityState {
    isVisible: boolean;
    intersectionRatio: number;
}

export type WidgetVisibilityMap = Map<string, WidgetVisibilityState>;

// ============ Context ============

interface WidgetVisibilityContextValue {
    registerWidget: (widgetId: string) => void;
    unregisterWidget: (widgetId: string) => void;
    getWidgetVisibility: (widgetId: string) => WidgetVisibilityState;
    gridRef: React.RefObject<HTMLDivElement | null>;
}

const WidgetVisibilityContext = createContext<WidgetVisibilityContextValue | null>(null);

// ============ Provider Props ============

export interface WidgetVisibilityProviderProps {
    children: ReactNode;
    rootMargin?: string;
    threshold?: number | number[];
}

// ============ Provider ============

export function WidgetVisibilityProvider({
    children,
    rootMargin = '320px 0px',
    threshold = 0,
}: WidgetVisibilityProviderProps) {
    const [visibilityMap] = useState<WidgetVisibilityMap>(() => new Map());
    const [registeredWidgets, setRegisteredWidgets] = useState<Set<string>>(() => new Set());
    const gridRef = useRef<HTMLDivElement | null>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);

    // Register a widget for observation
    const registerWidget = useCallback((widgetId: string) => {
        setRegisteredWidgets((prev) => {
            if (prev.has(widgetId)) return prev;
            const next = new Set(prev);
            next.add(widgetId);
            return next;
        });
        // Initialize with invisible state
        if (!visibilityMap.has(widgetId)) {
            visibilityMap.set(widgetId, { isVisible: false, intersectionRatio: 0 });
        }
    }, [visibilityMap]);

    // Unregister a widget
    const unregisterWidget = useCallback((widgetId: string) => {
        setRegisteredWidgets((prev) => {
            if (!prev.has(widgetId)) return prev;
            const next = new Set(prev);
            next.delete(widgetId);
            return next;
        });
        visibilityMap.delete(widgetId);
    }, [visibilityMap]);

    // Get visibility state for a widget
    const getWidgetVisibility = useCallback((widgetId: string): WidgetVisibilityState => {
        return visibilityMap.get(widgetId) ?? { isVisible: false, intersectionRatio: 0 };
    }, [visibilityMap]);

    // Set up single IntersectionObserver
    useEffect(() => {
        // Create observer
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    const widgetId = entry.target.getAttribute('data-widget-id');
                    if (!widgetId) return;

                    const isVisible = entry.isIntersecting;
                    const intersectionRatio = entry.intersectionRatio;

                    visibilityMap.set(widgetId, { isVisible, intersectionRatio });

                    // Force re-render for widgets that changed visibility
                    if (isVisible !== visibilityMap.get(widgetId)?.isVisible) {
                        // The map mutation will be reflected in the next render
                        // We don't need to forceUpdate here since widgets read from the map
                    }
                });
            },
            {
                root: null, // viewport
                rootMargin,
                threshold,
            }
        );

        observerRef.current = observer;

        return () => {
            observer.disconnect();
            observerRef.current = null;
        };
    }, [visibilityMap, rootMargin, threshold]);

    // Observe registered widgets
    useEffect(() => {
        const observer = observerRef.current;
        if (!observer) return;

        const grid = gridRef.current;
        if (!grid) return;

        // Observe all widget elements within the grid
        const widgetElements = grid.querySelectorAll<HTMLElement>('[data-widget-id]');
        widgetElements.forEach((element) => {
            const widgetId = element.getAttribute('data-widget-id');
            if (widgetId && registeredWidgets.has(widgetId)) {
                observer.observe(element);
            }
        });

        return () => {
            // Cleanup is handled by the observer lifecycle
        };
    }, [registeredWidgets]);

    const value = useMemo(() => ({
        registerWidget,
        unregisterWidget,
        getWidgetVisibility,
        gridRef,
    }), [registerWidget, unregisterWidget, getWidgetVisibility, gridRef]);

    return (
        <WidgetVisibilityContext.Provider value={value}>
            {children}
        </WidgetVisibilityContext.Provider>
    );
}

// ============ Hook ============

export function useWidgetVisibility(widgetId: string, options?: {
    eagerThreshold?: number;
    fallbackDelay?: number;
}): boolean {
    const context = useContext(WidgetVisibilityContext);
    const [isVisible, setIsVisible] = useState(false);
    const [mounted, setMounted] = useState(false);

    const eagerThreshold = options?.eagerThreshold ?? 32;
    const fallbackDelay = options?.fallbackDelay ?? 1500;

    // Register/unregister widget
    useEffect(() => {
        setMounted(true);
        if (!context) {
            // No context available, use fallback
            setIsVisible(true);
            return;
        }

        context.registerWidget(widgetId);
        return () => {
            context.unregisterWidget(widgetId);
        };
    }, [context, widgetId]);

    // Check visibility via context or fallback
    useEffect(() => {
        if (!mounted) return;
        if (!context) {
            // No context, use fallback timer
            const timer = setTimeout(() => setIsVisible(true), fallbackDelay);
            return () => clearTimeout(timer);
        }

        // Initial visibility check via bounding rect
        const checkVisibility = () => {
            const element = document.querySelector(`[data-widget-id="${widgetId}"]`) as HTMLElement | null;
            if (!element) {
                setIsVisible(true);
                return;
            }

            try {
                const rect = element.getBoundingClientRect();
                const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
                const inViewport = rect.bottom > -300 && rect.top < viewportH + 300;
                const hasSize = rect.width >= eagerThreshold && rect.height >= 16;

                if (inViewport && hasSize) {
                    setIsVisible(true);
                    return;
                }
            } catch {
                // ignore
            }

            // Subscribe to visibility updates via context
            const checkFromMap = () => {
                const state = context.getWidgetVisibility(widgetId);
                setIsVisible(state.isVisible);
            };

            // Check immediately and set up polling
            checkFromMap();
            const interval = setInterval(checkFromMap, 500);
            return () => clearInterval(interval);
        };

        checkVisibility();
    }, [context, mounted, widgetId, eagerThreshold, fallbackDelay]);

    return isVisible;
}

// ============ Grid Ref Export ============

export function useWidgetVisibilityGridRef() {
    const context = useContext(WidgetVisibilityContext);
    return context?.gridRef ?? { current: null };
}

// ============ Compatibility Hook (for WidgetWrapper) ============

// Simplified hook for backward compatibility with existing WidgetWrapper
// Falls back to individual observers if not inside a grid context
export function useWidgetLazyMount(options?: {
    eagerMount?: boolean;
    rootY?: number;
    fallbackDelay?: number;
}): {
    isContentVisible: boolean;
    contentHostRef: React.RefObject<HTMLDivElement | null>;
} {
    const [isContentVisible, setIsContentVisible] = useState(false);
    const contentHostRef = useRef<HTMLDivElement | null>(null);
    const optionsRef = useRef(options);

    useEffect(() => {
        optionsRef.current = options;
    });

    useEffect(() => {
        if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
            setIsContentVisible(true);
            return;
        }

        const node = contentHostRef.current;
        if (!node) {
            setIsContentVisible(true);
            return;
        }

        const opts = optionsRef.current ?? {};
        const rootY = opts.rootY ?? -300;
        const fallbackDelay = opts.fallbackDelay ?? 1500;

        // Check immediate visibility
        try {
            const rect = node.getBoundingClientRect();
            const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
            const inViewport = rect.bottom > rootY && rect.top < viewportH + Math.abs(rootY);
            const hasSize = rect.width >= 32 && rect.height >= 16;

            if (opts.eagerMount || (inViewport && hasSize)) {
                setIsContentVisible(true);
                return;
            }
        } catch {
            // ignore
        }

        // Use IntersectionObserver
        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry?.isIntersecting) {
                    setIsContentVisible(true);
                    observer.disconnect();
                }
            },
            { rootMargin: '320px 0px' }
        );

        const fallbackTimer = window.setTimeout(() => {
            setIsContentVisible(true);
            observer.disconnect();
        }, fallbackDelay);

        observer.observe(node);
        return () => {
            window.clearTimeout(fallbackTimer);
            observer.disconnect();
        };
    }, []);

    return { isContentVisible, contentHostRef };
}
