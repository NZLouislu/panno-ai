const nextJest = require('next/jest')

const createJestConfig = nextJest({
    dir: './',
})

const customJestConfig = {
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    testEnvironment: 'jest-environment-jsdom',
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
    collectCoverage: true,
    coverageThreshold: {
        global: {
            branches: 65,
            functions: 60,
            lines: 80,
            statements: 80,
        },
    },
    transformIgnorePatterns: [
        '/node_modules/(?!lucide-react)/'
    ],
}

module.exports = createJestConfig(customJestConfig)
