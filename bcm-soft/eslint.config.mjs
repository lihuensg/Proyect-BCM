import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
    ],
  },
  js.configs.recommended,
  tseslint.configs.strict,
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-extraneous-class": [
        "error",
        { allowWithDecorator: true },
      ],
    },
  },
  {
    files: ["apps/api/src/**/*.ts"],
    ignores: ["apps/api/src/config/server-config.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.name='process'][property.name='env']",
          message:
            "Read process.env only through the server configuration boundary.",
        },
      ],
    },
  },
  {
    files: ["apps/api/src/**/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/infrastructure/database/tenant-transaction*"],
              message:
                "Product Application code must use TenantPersistenceScope instead of the foundation-only tenant transaction helper.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/api/src/tenancy/application/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@prisma/client",
                "**/generated/prisma/**",
                "@nestjs/**",
                "**/infrastructure/**",
              ],
              message:
                "Tenancy application contracts must not depend on Prisma, Nest, or Infrastructure.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/api/src/tenancy/presentation/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@prisma/client",
                "**/generated/prisma/**",
                "**/infrastructure/**",
              ],
              message:
                "Tenancy Presentation must not depend on Prisma or Infrastructure.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/config/public-config.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.type='MetaProperty'][property.name='env']",
          message:
            "Read import.meta.env only through the public Web configuration boundary.",
        },
      ],
    },
  },
);
