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
