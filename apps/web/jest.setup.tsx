import '@testing-library/jest-dom'

// Mock Framer Motion
jest.mock('framer-motion', () => ({
    motion: {
        div: ({ children, ...props }: any) => <div { ...props } > { children } </div>,
    h1: ({ children, ...props }: any) => <h1 { ...props } > { children } </h1>,
    h2: ({ children, ...props }: any) => <h2 { ...props } > { children } </h2>,
    span: ({ children, ...props }: any) => <span { ...props } > { children } </span>,
    },
    AnimatePresence: ({ children }: any) => <>{ children } </>,
}))

// Mock Next.js router
jest.mock('next/navigation', () => ({
    useRouter: () => ({
        push: jest.fn(),
        replace: jest.fn(),
        prefetch: jest.fn(),
        back: jest.fn(),
    }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}))

// jsdom lacks these browser APIs; widgets that observe layout/visibility or
// probe media queries would otherwise throw on mount.
class MockObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
}
;(globalThis as any).IntersectionObserver ??= MockObserver
;(globalThis as any).ResizeObserver ??= MockObserver

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {}
}

if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
}
