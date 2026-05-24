import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "dist/**",
      "server-dist/**",
      "node_modules/**",
      "output/**",
      "tmp/**",
      "knowledge/uploads/**",
      "src/generatedKnowledge.ts",
      "server/generatedKnowledge.ts",
      "server/generatedKnowledge.json"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  }
];
