import { defineConfig } from 'vite';
import glsl from 'vite-plugin-glsl';

export default defineConfig({
    plugins: [
        glsl({
            include: ['**/*.wgsl'],
            exclude: ['**/*.wgsl.d.ts'],
            defaultExtension: 'wgsl',
            warnDuplicatedImports: true,
            removeDuplicatedImports: true,
            watch: true,
        }),
    ],
});
