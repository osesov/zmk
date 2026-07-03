# Contributing to ZMK

Thank you for your interest in contributing to ZMK (Zodiac Make)! This document provides information about the extension's architecture, development setup, and guidelines for contributors.

## Development Setup

### Prerequisites

- Node.js (v24 or later)
- npm
- VS Code

### Building from Source

```bash
# Clone the repository
git clone <repository-url>
cd zmk

# Install dependencies
npm install

# Build the extension
npm run build

# Watch mode for development (auto-rebuild on changes)
npm run watch

# Package extension as VSIX
npm run package
```

### Running and Debugging

1. Open the project in VS Code
2. Press F5 to launch the Extension Development Host
3. Open a Valhalla workspace in the new window
4. Set breakpoints in the source code as needed

## Architecture

The extension is built using a service-oriented architecture with dependency injection via a custom `ServiceContainer`. This design provides modularity, testability, and clear separation of concerns.

### Core Components

#### Service Container

The `ServiceContainer` class (`src/services/ServiceContainer.ts`) provides a lightweight dependency injection system that manages service lifecycle and dependencies.

**Features:**

- **Instance registration**: Pre-created objects registered directly
- **Factory registration**: Lazy-initialized services created on first access
- **Dependency resolution**: Automatic resolution of service dependencies
- **Singleton pattern**: Services are created once and reused

**Usage:**

```typescript
// Register a service
container.registerInstance(ISettingsService, settingsService);
container.registerFactory(IBuilderService, () => new BuilderService(container));

// Retrieve a service
const builder = container.get(IBuilderService);
```

#### Main Services

The extension is composed of several key services, each with a specific responsibility:

##### BuilderService

**Location**: `src/services/impl/BuilderService.ts`

**Responsibilities:**

- Executes `gnb` build commands
- Manages build process lifecycle
- Handles build output streaming
- Emits build status events

**Key Methods:**

- `build(target?, flags?)`: Execute build command
- `cleanBuild(target?, flags?)`: Clean and rebuild
- `deepCleanBuild(target?, flags?)`: Remove build directory and rebuild

##### ProjectInfoService

**Location**: `src/services/impl/ProjectInfoService.ts`

**Responsibilities:**

- Parses GN's `project.json` file
- Provides project structure information
- Caches project metadata with mtime-based invalidation
- Maps targets to source files

**Key Methods:**

- `getProjectInfo()`: Get parsed project information
- `getTargets()`: Get list of build targets
- `getTargetInfo(targetName)`: Get details for specific target

##### SettingsService

**Location**: `src/services/impl/SettingsService.ts`

**Responsibilities:**

- Manages extension settings
- Provides access to workspace configuration
- Resolves setting values with variable substitution
- Monitors setting changes

**Key Methods:**

- `get<T>(key)`: Get setting value
- `set(key, value)`: Update setting value
- `getRootDir()`: Get Valhalla root directory
- `getBuildDir()`: Get build output directory

##### StatusService

**Location**: `src/services/impl/StatusService.ts`

**Responsibilities:**

- Updates VS Code status bar
- Shows current build configuration
- Displays build progress
- Provides quick access to commands

##### BuildStatusService

**Location**: `src/services/impl/BuildStatusService.ts`

**Responsibilities:**

- Tracks build state (idle, building, success, failure)
- Notifies listeners of build events
- Manages build status transitions

##### UIService

**Location**: `src/services/impl/UIService.ts`

**Responsibilities:**

- Handles user interactions
- Shows dialogs and prompts
- Manages user configuration flow

##### ValhallaCppToolsProviderService

**Location**: `src/services/impl/ValhallaCppToolsProviderService.ts`

**Responsibilities:**

- Integrates with VS Code C++ extension
- Implements `CustomConfigurationProvider` interface
- Provides IntelliSense configuration per file
- Updates configurations after builds

##### ConfigTreeProvider

**Location**: `src/services/impl/ConfigTreeDataProvider.ts`

**Responsibilities:**

- Provides tree view for build configurations
- Scans `configs/*.yaml` files
- Highlights current configuration
- Handles configuration selection

##### TargetTreeProvider

**Location**: `src/services/impl/TargetTreeProvider.ts`

**Responsibilities:**

- Provides tree view for build targets
- Reads targets from `project.json`
- Organizes targets by GN path hierarchy
- Indicates default target

##### SourceFileConfigurationItemTreeProvider

**Location**: `src/services/impl/SourceFileConfigurationItemTreeProvider.ts`

**Responsibilities:**

- Shows IntelliSense settings for current file
- Displays include paths (list or tree view)
- Shows preprocessor defines
- Shows compiler settings

##### ValhallaTaskProvider

**Location**: `src/components/tasks.ts`

**Responsibilities:**

- Provides custom tasks of type `gnb`
- Creates automatic build tasks
- Monitors task execution
- Updates build status after task completion

### Key Data Structures

#### CompileCommands

**Location**: `src/components/CompileCommands.ts`

Parses and caches `compile_commands.json` to provide source file configuration.

**Key Features:**

- Extracts include paths from compiler flags (`-I`, `-isystem`, etc.)
- Parses preprocessor defines (`-D`)
- Determines C++ standard from `-std=` flag
- Infers IntelliSense mode from compiler path
- Supports custom toolchain configurations via `zmk.toolchain` settings
- Caches parsed data with mtime-based invalidation

**Key Methods:**

- `getConfiguration(sourceFile)`: Get IntelliSense config for a file
- `refresh()`: Reload compile commands from file
- `hasFile(sourceFile)`: Check if file is in compile commands

**Configuration Resolution:**

1. Parse compiler command line
2. Extract flags and arguments
3. Apply toolchain-specific overrides
4. Merge with user settings
5. Return complete configuration

#### ProjectInfo

**Location**: `src/components/ProjectInfo.ts`

Reads and parses GN's `project.json` file containing build metadata.

**Key Features:**

- Maps GN targets to source files
- Resolves target dependencies
- Provides configuration data (defines, include paths, compiler flags)
- Caches parsed data with mtime-based invalidation
- Supports lazy loading of target information

**Data Structure:**

```typescript
{
    targets: {
        [targetName: string]: {
            type: string;           // executable, shared_library, source_set, etc.
            sources: string[];
            deps: string[];
            configs: string[];
            defines: string[];
            include_dirs: string[];
        }
    }
}
```

#### ArgsFile

**Location**: `src/components/ArgsFile.ts`

Manages GN build arguments from `args.gn` files.

**Key Features:**

- Reads `args.gn` files from build output
- Parses toolchain configuration
- Supports pattern-based toolchain selection
- Extracts cross-compilation settings

**Parsed Information:**

- `cross_os`: Target operating system
- `cross_cpu`: Target CPU architecture
- `cross_abi`: Target ABI
- Other GN arguments

## Implementation Details

### Extension Activation Flow

When the extension activates:

1. **Service Registration**
   - All services are registered in the `ServiceContainer`
   - Dependencies between services are established

2. **Valhalla Detection**
   - Searches workspace folders for Valhalla root
   - Looks for `gnb` or `gnbc` script
   - Verifies presence of `configs/` directory

3. **Initial Build**
   - Runs minimal build (`empty` target)
   - Generates `compile_commands.json`
   - Generates `project.json`

4. **Provider Registration**
   - Registers custom configuration provider with C++ extension (if enabled)
   - Registers task provider for `gnb` tasks

5. **View Registration**
   - Creates tree views for configurations, targets, and source file settings
   - Sets up view event handlers

6. **Command Registration**
   - Registers all extension commands
   - Sets up command handlers

### Build Process

The build process follows these steps:

1. **Command Construction**
   - `BuilderService` constructs `gnb` command
   - Adds configuration and target arguments
   - Applies additional flags from settings or task definition

2. **Process Execution**
   - Spawns child process with build command
   - Sets working directory and environment variables

3. **Output Handling**
   - Streams stdout/stderr to dedicated output channel
   - Parses output for errors and warnings
   - Updates problem matchers

4. **Status Updates**
   - Updates status bar with build progress
   - Emits build events to listeners
   - Tracks build state transitions

5. **Metadata Refresh**
   - After successful build, reloads `compile_commands.json`
   - Reloads `project.json`
   - Invalidates caches

6. **IntelliSense Update**
   - Notifies C++ extension of configuration changes
   - Triggers IntelliSense refresh for open files

### IntelliSense Configuration Flow

When a C/C++ file is opened or configuration is requested:

1. **File Open Event**
   - VS Code C++ extension calls `CustomConfigurationProvider.canProvideConfiguration()`
   - Extension checks if file exists in `compile_commands.json`

2. **Configuration Request**
   - C++ extension calls `provideConfigurations([files])`
   - Extension looks up each file in compile commands cache

3. **Command Parsing**
   - Parses compiler command line
   - Extracts include paths using regex patterns:
     - `-I<path>` - Include directory
     - `-isystem <path>` - System include
     - `-iquote <path>` - Quote include
   - Extracts defines: `-D<name>[=<value>]`
   - Extracts C++ standard: `-std=c++XX`
   - Identifies compiler path from command

4. **Toolchain Selection**
   - Reads `args.gn` to determine toolchain
   - Matches against `zmk.toolchain` patterns
   - Applies toolchain-specific settings

5. **Configuration Merge**
   - Starts with settings from compile commands
   - Applies toolchain configuration overrides
   - Merges user settings (`zmk.includeDirs`, `zmk.defines`, etc.)
   - Returns final configuration

6. **Cache Management**
   - Configurations are cached per file
   - Cache invalidated when compile commands file changes
   - Cache invalidated when settings change

### Project Information Management

Project metadata is managed as follows:

1. **project.json Parsing**
   - Reads JSON file generated by GN
   - Parses target definitions
   - Extracts target metadata

2. **Target Graph**
   - Builds dependency graph from target deps
   - Resolves transitive dependencies
   - Supports circular dependency detection

3. **Source Mapping**
   - Maps source files to containing targets
   - Handles source files in multiple targets
   - Supports generated source files

4. **Configuration Extraction**
   - Extracts per-target settings
   - Resolves config inheritance
   - Merges target configs

5. **Lazy Loading**
   - Parses target information on-demand
   - Caches parsed targets
   - Minimizes memory usage for large projects

6. **Cache Invalidation**
   - Monitors `project.json` modification time
   - Reloads when file changes
   - Clears dependent caches

### Tree View Implementation

Tree views are implemented using VS Code's `TreeDataProvider` interface:

#### Configuration Tree

1. **Data Source**
   - Scans `configs/*.yaml` files
   - Parses configuration names from filenames

2. **Tree Structure**
   - Flat list of configurations
   - Current configuration highlighted

3. **Refresh Logic**
   - Manual refresh via command
   - Automatic refresh after configuration change

4. **User Actions**
   - Click to select configuration
   - Context menu for additional actions

#### Target Tree

1. **Data Source**
   - Reads targets from `project.json`
   - Filters and sorts target list

2. **Tree Structure**
   - Hierarchical organization by GN path
   - Nodes for directories and targets
   - Shows target type icons

3. **Refresh Logic**
   - Refreshes after build completion
   - Manual refresh via command

4. **User Actions**
   - Click to set default target
   - Context menu to build specific target

#### Source File Configuration Tree

1. **Data Source**
   - Reads configuration for active editor file
   - Parses include paths and defines

2. **Tree Structure**
   - Root nodes: Includes, Defines, Compiler
   - Child nodes for individual items
   - Supports list or tree view for includes

3. **Refresh Logic**
   - Updates when active editor changes
   - Refreshes after build

4. **User Actions**
   - Toggle between list and tree view
   - Copy values to clipboard

### Utility Features

#### Copyright Header Management

The `zmk.updateCopyright` command:

1. **Language Detection**
   - Determines file language from extension
   - Currently supports C/C++ (`//` comments)

2. **Existing Header Search**
   - Searches file start for copyright comment
   - Detects multi-line comment blocks

3. **Template Processing**
   - Uses template from `zmk.copyrightComment` setting
   - Substitutes placeholders:
     - `${developer}`: From `zmk.developer` setting
     - `${year}`: Current year
     - `${date}`: Current date (YYYY-MM-DD)

4. **Header Insertion**
   - Inserts at file start if no header exists
   - Replaces existing header if found

#### Bundle Include Path Automation

The `zmk.updateBundlesInclude` command:

1. **Bundle Directory Scan**
   - Scans `zmk.bundleDir` for subdirectories
   - Identifies bundle directories

2. **Bundle Filtering**
   - Filters out excluded bundles from `zmk.excludeBundles`
   - Checks for `include/` subdirectory

3. **Path Generation**
   - Generates include paths using `${env:zmk.bundleDir}` prefix
   - Creates glob pattern for all bundles

4. **Configuration Update**
   - Reads `c_cpp_properties.json`
   - Removes old bundle paths
   - Adds new bundle paths
   - Preserves other include paths

5. **User Confirmation**
   - Shows diff preview
   - Prompts for confirmation
   - Writes updated configuration

## Project Structure

```text
zmk/
├── src/
│   ├── extension.ts                    # Extension entry point
│   ├── components/                     # Utility components
│   │   ├── ArgsFile.ts                 # GN args parser
│   │   ├── CompileCommands.ts          # compile_commands.json parser
│   │   ├── constants.ts                # Constants and enums
│   │   ├── Interactions.ts             # User interaction helpers
│   │   ├── LazyCache.ts                # Caching utility
│   │   ├── parseTarget.ts              # Target name parser
│   │   ├── ProjectInfo.ts              # project.json parser
│   │   ├── promise.ts                  # Promise utilities
│   │   ├── SourceFileConfiguration.ts  # IntelliSense config types
│   │   ├── tasks.ts                    # Task provider
│   │   └── utils.ts                    # General utilities
│   ├── services/                       # Service interfaces
│   │   ├── AppServices.ts              # Service type definitions
│   │   ├── IBuilderService.ts
│   │   ├── IBuildStatusService.ts
│   │   ├── IConfigTreeProvider.ts
│   │   ├── IProjectInfoService.ts
│   │   ├── ISettingsService.ts
│   │   ├── ISourceFileConfigurationItemTreeProvider.ts
│   │   ├── IStatusService.ts
│   │   ├── ITargetTreeProvider.ts
│   │   ├── IUIService.ts
│   │   ├── IValhallaCppTools.ts
│   │   ├── IValhallaTaskProvider.ts
│   │   ├── IVirtualDocumentProvider.ts
│   │   ├── ServiceContainer.ts         # DI container
│   │   └── impl/                       # Service implementations
│   │       ├── BuilderService.ts
│   │       ├── BuildStatusService.ts
│   │       ├── ConfigTreeDataProvider.ts
│   │       ├── ProjectInfoService.ts
│   │       ├── SettingsService.ts
│   │       ├── SourceFileConfigurationItemTreeProvider.ts
│   │       ├── StatusService.ts
│   │       ├── TargetTreeProvider.ts
│   │       ├── UIService.ts
│   │       ├── ValhallaCppToolsProviderService.ts
│   │       └── VirtualDocumentProviderService.ts
│   └── test/
│       └── extension.test.ts           # Extension tests
├── config-examples/                    # Configuration examples
│   ├── appcloud/                       # AppCloud config
│   └── zebra/                          # Zebra config
├── images/                             # Extension images
├── build.js                            # Build script
├── eslint.config.mts                   # ESLint configuration
├── package.json                        # Extension manifest
├── tsconfig.json                       # TypeScript configuration
├── CHANGELOG.md                        # Release notes
├── README.md                           # User documentation
├── CONTRIBUTING.md                     # This file
└── LICENSE                             # License file
```

## Development Workflow

### Making Changes

1. **Create a branch** for your changes
2. **Make your changes** in the `src/` directory
3. **Test your changes** using the Extension Development Host (F5)
4. **Build the extension** with `npm run build`
5. **Run linting** with `npm run lint`
6. **Commit your changes** with clear commit messages

### Testing

- **Manual testing**: Use F5 to launch Extension Development Host
- **Unit tests**: Run `npm test` (tests in `src/test/`)
- **Integration testing**: Test with real Valhalla workspace

### Code Style

- Follow TypeScript best practices
- Use meaningful variable and function names
- Add comments for complex logic
- Keep functions focused and small
- Use interfaces for service contracts

### Commit Guidelines

- Use clear, descriptive commit messages
- Reference issues when applicable
- Keep commits focused on a single change

## Extension Architecture Patterns

### Dependency Injection

Services use constructor injection:

```typescript
class BuilderService implements IBuilderService {
    constructor(
        private container: ServiceContainer
    ) {}

    private get settings() {
        return this.container.get(ISettingsService);
    }
}
```

### Event-Driven Communication

Services communicate via events:

```typescript
// Service emits event
buildStatusService.onBuildComplete(() => {
    // Handle build completion
});

// In BuilderService
private emitBuildComplete() {
    this.buildStatusService.notifyBuildComplete();
}
```

### Lazy Initialization

Resources are initialized on-demand:

```typescript
class LazyCache<T> {
    private value?: T;
    private loader: () => T;

    get(): T {
        if (!this.value) {
            this.value = this.loader();
        }
        return this.value;
    }
}
```

### Cache Invalidation

Caches are invalidated by file modification:

```typescript
class CompileCommands {
    private cache?: ParsedData;
    private mtime?: number;

    private async checkCache() {
        const stat = await fs.stat(this.filePath);
        if (!this.cache || stat.mtimeMs !== this.mtime) {
            this.cache = await this.parse();
            this.mtime = stat.mtimeMs;
        }
    }
}
```

## References

### VS Code Extension Development

- [VS Code API Documentation](https://code.visualstudio.com/api/references/vscode-api)
- [Extension Guides](https://code.visualstudio.com/api/extension-guides/overview)
- [VS Code Extension Samples](https://github.com/microsoft/vscode-extension-samples)
- [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)

### C++ Extension Integration

- [C++ Extension API](https://github.com/microsoft/vscode-cpptools/blob/main/Documentation/LanguageServer/customProviders.md)
- [Custom Configuration Provider](https://github.com/microsoft/vscode-cpptools/blob/main/Documentation/LanguageServer/customProviders.md#custom-configuration-provider)
- [IntelliSense Configuration](https://code.visualstudio.com/docs/cpp/c-cpp-properties-schema-reference)

### Build System Documentation

- [GN Reference](https://gn.googlesource.com/gn/+/main/docs/reference.md)
- [GN Language and Operation](https://gn.googlesource.com/gn/+/main/docs/language.md)
- [Ninja Build Manual](https://ninja-build.org/manual.html)

### TypeScript

- [TypeScript Documentation](https://www.typescriptlang.org/docs/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

## Questions?

If you have questions about contributing, please open an issue in the repository or contact the maintainers.

## License

By contributing to ZMK, you agree that your contributions will be licensed under the same license as the project. See [LICENSE](LICENSE) for details.
