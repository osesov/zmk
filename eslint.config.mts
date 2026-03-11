// import js from "@eslint/js";
// import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
    // {
    //     files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
    //     plugins: { js },
    //     extends: ["js/recommended"],
    //     languageOptions: {
    //         globals: globals.node
    //     },
    // },
    {
        files: ["src/**/*.{ts,mts,cts,js,mjs,cjs}"],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    ...tseslint.configs.recommended,
    {
        "rules": {
            "@typescript-eslint/naming-convention": "warn",
            "@typescript-eslint/no-unused-expressions": "warn",
            "@typescript-eslint/no-unused-vars": "warn",
            "curly": "warn",
            "eqeqeq": [
                "warn",
                "always"
            ],
            "no-unused-vars": "off",
            "no-redeclare": "warn",
            "no-throw-literal": "warn",
            "no-unused-expressions": "off",
        }
    }
]);
