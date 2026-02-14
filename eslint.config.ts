import js from "@eslint/js"
import eslintConfigPrettier from "eslint-config-prettier"
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript"
import { importX } from "eslint-plugin-import-x"
import eslintPluginUnicorn from "eslint-plugin-unicorn"
import tseslint from "typescript-eslint"

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "prettier.config.js"],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  importX.flatConfigs.recommended,
  eslintConfigPrettier,
  {
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      "import-x/resolver-next": [
        createTypeScriptImportResolver({
          project: "./tsconfig.eslint.json",
        }),
      ],
    },
    plugins: {
      unicorn: eslintPluginUnicorn,
    },
    rules: {
      // Base
      "no-console": "off",
      "no-nested-ternary": "error",

      // Allow unused variables prefixed with underscore
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // Allow numbers and booleans in template literals (safe & idiomatic)
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],

      // TypeScript strict assertions
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/no-unsafe-type-assertion": "error",

      // Unicorn
      "unicorn/error-message": "error",
      "unicorn/no-instanceof-array": "error",
      "unicorn/no-useless-undefined": "error",
      "unicorn/prefer-node-protocol": "error",
      "unicorn/prefer-number-properties": "error",
      "unicorn/prefer-string-replace-all": "error",
      "unicorn/prefer-array-find": "error",
      "unicorn/no-array-for-each": "error",
      "unicorn/no-lonely-if": "error",
      "unicorn/prefer-optional-catch-binding": "error",

      // Import
      "import-x/no-duplicates": "error",
      "import-x/first": "error",
      "import-x/no-cycle": "error",
      "import-x/no-self-import": "error",
      "import-x/no-useless-path-segments": "error",
    },
  },
)
