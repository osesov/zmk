# Change Log

All notable changes to the "zmk" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 2.5.0

- Implemented experimental LM tools:
  - listConfigs
  - buildTarget
- ArgsTreeProvider: copy arg value and arg name=value pair

## 2.4.0

- Support `Browse Set`: Set of targets, which are reported to C/C++ tools as browse configuration.
- Target Tree View:
  - Allow so maintain browse set
  - Show target type in description (group, source_set, shared_library, static_library, executable, ...)
  - Copy target name to clipboard
  - Open BUILD.gn for the given target
  - Show target information (deps, sources, flags, etc...)
  - Allow to copy target data to clipboard
  - individual handling
    - deps: allow to go to item in the target tree
    - sources: allow to open file
    - include_dirs: allow to reveal in file explorer and open is OS file manager
  - Allow to find target by name
  - Show reverse dependencies (i.e. targets, which depends on the current one)

## 2.3.0

- Propose to update extension daily

## 2.2.0

- Integrate with Test Controller
- Interactive command to tun test

## 2.1.0

- Interactive command to run build
- Fix for non-valhalla workspaces

## 2.0.0

Major architectural refactoring and feature enhancements.

### Added

- **Service-Oriented Architecture**: Implemented dependency injection container (`ServiceContainer`) for better modularity and testability
- **Tree Views**: Added three custom tree views in "Valhalla build system" activity bar:
  - **Configurations View**: Browse and select build configurations from `configs/*.yaml`
  - **Targets View**: Navigate build targets from `project.json`, set default targets, build individual targets
  - **Source File Configuration View**: Inspect IntelliSense settings for current file (includes, defines, compiler settings) with list/tree toggle
- **Custom Task Provider**: Implemented `gnb` task type with automatic task generation for each workspace (Build, Clean build, Deep clean build, Minimal build)
- **Enhanced IntelliSense Integration**: Full `CustomConfigurationProvider` implementation for VS Code C++ Extension:
  - Automatic parsing of `compile_commands.json`
  - Per-file configuration with includes, defines, compiler settings
  - Custom toolchain support via `zmk.toolchain` setting with pattern-based matching
  - Lazy loading and caching with mtime-based invalidation
- **Project Information Service**: GN `project.json` parser for target metadata and dependency graph
- **Build Status Tracking**: Real-time build status with event notifications and status bar integration
- **Dev Container Support**: Automatic detection and `gnbc` command usage in dev containers

### Changed

- **Complete Code Restructure**: Migrated from monolithic architecture to service-based architecture
- **Settings Service**: Centralized configuration management with type-safe access
- **Builder Service**: Refactored build execution with improved process management and output handling
- **Improved Extension Activation**: Asynchronous service initialization with proper event handling

### Enhanced

- **Toolchain Configuration**: Added `zmk.toolchain` setting for pattern-based toolchain selection with per-toolchain defines, includes, and environment variables
- **IntelliSense Settings**: New settings for custom compiler configuration:
  - `zmk.disableCppToolsIntegration`: Option to disable custom configuration provider
  - `zmk.includeDirs`: Extra include directories
  - `zmk.defines`: Extra preprocessor defines
  - `zmk.compiler`: Compiler path and arguments
  - `zmk.intelliSenseMode`: IntelliSense mode override
  - `zmk.cppStandard`: C++ standard override
- **Dynamic Settings Commands**: All settings now available as VS Code command variables for use in configuration files
- **Comprehensive Documentation**: Extensively updated README.md with architecture details, implementation guide, and usage examples

### Fixed

- Multiple workspace folder support improvements
- Configuration caching and invalidation logic
- Error handling and user feedback

## 1.3.3

- update dependencies to the latest
- update to use multiple work spaces
- do not report errors when run in non-valhalla environment
- Update config examples

## 1.3.2

- Add appcloud/zebra config examples

## 1.3.1

- Fix error messages

## 1.3

- Implemented copyright header insert/update for C++ files.
  Developer name could be configured with 'zmk.developer' settings.
  Copyright template is configured with 'zmk.copyrightComment' setting.

## 1.2.0

- implemented "zmk.bundleDir" setting
- Update zmkUpdateBundlesInclude to use ${env:zmk.bundleDir} prefix.

## 1.1.0

- Export zmk variables as env:zmk.XXX  for c_cpp_properties.json.
  In particular that allows zmk-generated paths to be used in compileCommands path, like that:

      "compileCommands": "${env:zmk.buildDir}/compile_commands.json"

- Allow to show generated c_cpp_properties.json as virtual doc

## 1.0.6

- command: zmkUpdateBundlesInclude.

  Command allows to update c_cpp_properties.json, replacing/adding bundle include paths.

  Note that only these configurations are updated, which already refer path, starting from "${env:zmk.bundleDir}".

  Config setting "zmk.excludeBundles" can be used to exclude some bundles (these might be your work packages).

## 1.0.5

- introduce zmkGetCurrentFile to build single file only

## 1.0.4

- close configuration quick pick

## 1.0.3

- Show current gnb and ninja targets.
- Config selection shows currently selected item

## [Unreleased]

- Initial release
