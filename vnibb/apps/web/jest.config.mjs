import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
    // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
    dir: './',
})

// Add any custom config to be passed to Jest
/** @type {import('jest').Config} */
const config = {
    // Add more setup options before each test is run
    setupFilesAfterEnv: ['<rootDir>/jest.setup.tsx'],
    testEnvironment: 'jest-environment-jsdom',
    modulePathIgnorePatterns: ['<rootDir>/.next/'],
    testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/e2e/'],
    moduleNameMapper: {
        // Handle module aliases (if you have them in tsconfig.json)
        '^@/(.*)$': '<rootDir>/src/$1',
    },
}

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
export default createJestConfig(config)
