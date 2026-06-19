import { defineConfig } from 'vitest/config'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    // Scope discovery to src/ only — prevents vitest from crawling symlinked
    // iCloud/system paths when run from the project root without a file argument.
    root: __dirname,
    include: ['src/**/*.{test,spec}.ts'],
    globalSetup: ['./vitest.setup.ts'],
  },
})
