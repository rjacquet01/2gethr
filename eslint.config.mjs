import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"

// Next.js recommended rules (React, hooks, accessibility basics, Core Web
// Vitals) plus its TypeScript rules. `npm run lint` runs this and must pass
// with no errors; warnings are the cleanup backlog.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Style: allowed for now, reported as warnings.
      "@typescript-eslint/no-explicit-any": "warn",
      "react/no-unescaped-entities": "warn",
      // React Compiler advice (performance and render purity), not crashes.
      // rules-of-hooks stays an error.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  {
    // One-off CommonJS helper scripts run with plain node.
    files: ["scripts/**/*.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // .claude/ holds local tool files (e.g. temporary worktrees), not app code.
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/**", ".claude/**"]),
])
