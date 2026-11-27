import { copyFileSync, mkdirSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    sourcemap: true,
    target: 'es2020',
    // The stylesheet ships next to the code: import '@glassware/core/glassware.css'
    onSuccess: async () => {
        mkdirSync('dist', { recursive: true });
        copyFileSync('src/glassware.css', 'dist/glassware.css');
    },
});