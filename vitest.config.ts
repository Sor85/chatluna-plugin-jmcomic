import { defineConfig } from 'vitest/config'
import yaml from '@cordisjs/unyaml/vite'

export default defineConfig({
  plugins: [yaml()],
  test: { include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'], testTimeout: 15000, restoreMocks: true }
})
