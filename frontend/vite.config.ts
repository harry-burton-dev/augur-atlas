import { isSharedModule } from '@augur/mfe-sdk/build';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// One ES module at dist/entry.js: the registry's entry URL for Data Atlas. React and the
// kits stay external; the shell serves them through its import map. Its Tailwind
// stylesheet is inlined and added to the page when it mounts.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    lib: { entry: 'src/entry.tsx', formats: ['es'], fileName: () => 'entry.js' },
    target: 'es2022',
    rollupOptions: { external: isSharedModule },
  },
  test: { environment: 'happy-dom' },
});
