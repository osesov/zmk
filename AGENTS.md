# ZMK Repository Guidance

## Project

ZMK is a VS Code extension for building and navigating Valhalla build system
that use GN and Ninja. It provides build commands, tree views,
IntelliSense configuration, test integration, and VS Code language-model tools.

Implemented in TypeScript.

Use Node.js 24 or later. Install the locked dependencies with:

```sh
npm ci
```

Treat `package.json` as the source of truth for available npm scripts and VS
Code contributions.

## Code Layout

- `src/extension.ts` is the activation entry point and service composition root.
- `src/services/AppServices.ts` defines the typed service map.
- `src/services/ServiceContainer.ts` implements dependency injection.
- `src/services/I*.ts` files define service contracts.
- `src/services/impl/*.ts` files implement services and their factory functions.
- `src/components/` contains parsers, data structures, process helpers, and
  other reusable logic.
- `package.json` declares commands, settings, views, menus, activation events,
  task definitions, and language-model tools.
- `build.js` bundles `src/extension.ts` into the ignored `dist/` directory.

## Change Rules

- Keep changes focused. Do not reformat unrelated code or clean up existing
  warnings unless the task requires it.
- Follow the style of the surrounding file. The repository contains legacy
  conventions that are intentionally reported as lint warnings.
- When adding a service, update its contract, factory, `AppServices` entry, and
  registration in `activate()` as applicable. Prefer narrow dependency types
  such as `Pick<AppServices, ...>`.
- Keep `package.json` contributions synchronized with runtime registrations.
  This especially applies to commands, configuration, views, tasks, activation
  events, and language-model tools.
- Register VS Code disposables with `context.subscriptions` or dispose them from
  the owning service. Respect cancellation tokens in asynchronous VS Code APIs.
- Reuse existing filesystem, settings, build, and UI services instead of adding
  parallel access paths.
- Pass child-process arguments as arrays and preserve `shell: false`. Do not
  interpolate user-controlled values into shell commands.
- Do not edit generated `dist/`, `out/`, `.vscode-test/`, or bundled Ninja
  binaries unless the task explicitly requires it.
- Update `README.md` when changing user-visible commands, settings, views,
  tasks, or behavior.

## Validation

Run the checks relevant to the changed files:

```sh
npm run compile
npm run lint
```

`npm run lint` currently permits existing legacy warnings but must exit with no
errors. Do not suppress a new warning without a specific reason.

Run `npm run bundle` when changing activation, module loading, dependencies, or
bundling behavior. Its output is generated under `dist/` and must not be
committed.

The current `npm test` harness is not reliable in a clean checkout:
`tsconfig.json` uses `noEmit` and excludes test files, while `.vscode-test.js`
looks for emitted tests under `out/test`. Do not claim tests passed unless the
harness is repaired and the tests were actually executed. Report this
limitation in the final result.

Do not run publishing or packaging commands merely for routine validation;
they can reinstall dependencies, access Git remotes, and create package
artifacts.
