import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
    {
        ignores: [
            ".local/**",
            ".vscode-test.js",
            ".vscode-test/**",
            "build.js",
            "dist/**",
            "node_modules/**",
            "out/**",
            "resources/**",
            "scripts/**",
        ],
    },
    ...tseslint.configs.recommended.map(config => ({
        ...config,
        files: ["src/**/*.{ts,mts,cts}"],
    })),
    {
        files: ["src/**/*.{ts,mts,cts}"],
        "rules": {
            "@typescript-eslint/naming-convention": [
                "error",
                // Enforce camelCase while permitting conventional unused names.
                {
                    "selector": "variableLike",
                    "format": ["camelCase"],
                    "leadingUnderscore": "allow"
                },
                // Constants in this codebase also use PascalCase and UPPER_CASE.
                {
                    "selector": "variable",
                    "modifiers": ["const"],
                    "format": ["camelCase", "PascalCase", "snake_case", "UPPER_CASE"],
                    "leadingUnderscore": "allow"
                },
                // Allow the existing mix of underscored and non-underscored private members
                {
                    "selector": "memberLike",
                    "modifiers": ["private"],
                    "format": ["camelCase"],
                    "leadingUnderscore": "allow"
                }
            ],
            // Preserve legacy patterns while still reporting them for cleanup.
            "@typescript-eslint/no-empty-object-type": "warn",
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-namespace": "off",
            "@typescript-eslint/no-unused-expressions": "warn",
            "@typescript-eslint/no-unused-vars": "warn",
            "curly": "off",
            "eqeqeq": [
                "warn",
                "always"
            ],
            "no-unused-vars": "off",
            "no-redeclare": "off",
            "no-throw-literal": "warn",
            "no-unused-expressions": "off",
            "prefer-const": "warn",
        }
    }
]);
