import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // worktree.test.ts drives a REAL throwaway git repo — a single test can
    // shell out to git ten times, and each call costs 200ms-1s on Windows.
    // At the 5s default those tests sat at 2.8-3.4s idle and timed out
    // whenever the machine was busy, which is the intermittent "four
    // timeouts" this suite was known for. The work is genuinely slow, not
    // hung: the repo lock has its own timebox, so a real wedge still fails.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
