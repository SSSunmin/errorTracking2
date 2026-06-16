import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**", "**/*.tsbuildinfo"]
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    }
  },
  {
    files: ["eslint.config.js", "vitest.config.ts", "**/vite.config.ts"],
    extends: [tseslint.configs.disableTypeChecked]
  },
  {
    files: ["packages/server/prisma/**/*.ts"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      parserOptions: {
        project: false,
        projectService: false
      }
    }
  },
  {
    // React patterns that conflict with the strict type-checked defaults.
    files: ["packages/dashboard/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-misused-promises": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unnecessary-condition": "off"
    }
  }
);
