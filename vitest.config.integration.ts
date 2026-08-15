import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Named so the three configs can be composed as projects for coverage.
        name: 'integration',
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/test/setup-integration.ts'],
        include: ['src/**/*.integration.test.{ts,tsx}'],
        exclude: ['node_modules', 'dist', 'e2e'],
        testTimeout: 10000, // Longer timeout for async operations
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'src/test/',
                '**/*.d.ts',
                '**/*.config.*',
                'e2e/',
            ],
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
