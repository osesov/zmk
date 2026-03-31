# zmk - Zodiac Make for Valhalla Build System

A VS Code extension for building and managing Valhalla projects. This extension provides comprehensive build system integration, IntelliSense support, and project navigation for Valhalla-based development.

![valhalla](./images/valhalla-doc.png)

## Overview

ZMK (Zodiac Make) streamlines Valhalla development workflows in VS Code with:

- **Build System Integration**: Direct integration with GN/Ninja build system via `gnb` command
- **Smart IntelliSense**: Automatic C++ IntelliSense configuration from your build
- **Project Navigation**: Visual tree views for configurations, targets, and source settings
- **Task Automation**: Pre-configured build, clean, and rebuild tasks
- **Dynamic Configuration**: Command-based settings for use in VS Code config files

## Requirements

- Valhalla source tree
- Valhalla build system with GN/Ninja
- VS Code C/C++ Extension (recommended for IntelliSense)

## Getting Started

1. **Open your Valhalla workspace** in VS Code
2. **Select C++ Tools Configuration provider** from the command pallette.
   `Ctrl+Shift+P`/`C/C++: Change Configuration Provider...` and select `Valhalla` provider.
3. **Select a build configuration** from the "Configurations" view in the sidebar
4. **Wait for initial build** - The extension automatically runs a minimal build to set up IntelliSense
5. **Select a build target** (optional) from the "Targets" view
6. **Start coding** with full IntelliSense support!

## Features

### Build Integration

Build your Valhalla projects directly from VS Code:

- **Quick builds** via tree view or commands
- **Build variants**:
  - Normal build - Builds selected target
  - Clean build - Removes target outputs before building
  - Deep clean build - Removes entire build directory
  - Minimal build - Generates build metadata only

### IntelliSense Integration

Get accurate C++ IntelliSense automatically:

- **Automatic configuration** from `compile_commands.json`
- **Per-file settings**: Include paths, defines, compiler flags
- **Custom toolchains** supported via settings
- **Real-time updates** after each build

### Visual Navigation

Three tree views in the "Valhalla build system" sidebar:

1. **Configurations**: Browse and select build configurations
2. **Targets**: View and build project targets
3. **Source File Configuration**: Inspect IntelliSense settings for the current file

### Build Tasks

Pre-configured tasks available in VS Code's task menu:

- Build
- Clean build
- Deep clean build
- Minimal build

Create custom `gnb` tasks with full control:

```json
{
    "type": "gnb",
    "label": "Build my component",
    "config": "zodiac-pc_linux-zebra-dev",
    "target": "components/my_component:my_component",
    "gnbFlags": ["-v"],
    "env": {
        "MY_VAR": "value"
    }
}
```

## Commands

### Build Commands

Access these commands via the Command Palette (Ctrl+Shift+P / Cmd+Shift+P):

- **`zmk.setConfig`**: Select build configuration
- **`zmk.buildTarget`**: Build selected target
- **`zmk.selectAndBuildTarget`**: Pick target to build
- **`zmk.setDefaultTarget`**: Set target as default
- **`zmk.resetTarget`**: Clear default target
- **`zmk.refreshConfigTree`**: Refresh configuration list
- **`zmk.refreshTargetTree`**: Refresh target list

### Utility Commands

- **`zmk.updateBundlesInclude`**: Auto-update C++ include paths with bundle directories
- **`zmk.updateCopyright`**: Insert or update copyright header in current file
- **`zmk.toggleIncludeListView`** / **`zmk.toggleIncludeTreeView`**: Change include path view mode

### Dynamic Configuration Commands

Use these in your VS Code configuration files (tasks.json, launch.json, etc.) with `${command:...}` syntax:

| Command | Returns | Example |
|---------|---------|---------|
| `${command:zmk.getTargetConfig}` | Current config name | `zodiac-pc_linux-zebra-dev` |
| `${command:zmk.getNinjaTarget}` | Current ninja target | `components/app:app` |
| `${command:zmk.getRootDir}` | Root Valhalla directory | `/home/user/valhalla` |
| `${command:zmk.getBuildDir}` | Build output directory | `/home/user/valhalla/out.${config}` |
| `${command:zmk.getNfsDir}` | NFS directory path | `${buildDir}/linux/build_nfs_image/home/zodiac` |

## Configuration

### Essential Settings

Configure ZMK in your workspace or user settings:

| Setting | Description | Default |
|---------|-------------|---------|
| `zmk.rootDir` | Root Valhalla source directory | Auto-detected |
| `zmk.buildDir` | Build output directory | `${rootDir}/out.${config}` |
| `zmk.config` | Build configuration name | - |
| `zmk.target` | Default ninja target to build | - |

### IntelliSense Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `zmk.disableCppToolsIntegration` | Disable automatic C++ IntelliSense integration | `false` |
| `zmk.includeDirs` | Additional include directories (array) | `[]` |
| `zmk.defines` | Additional preprocessor defines (object) | `{}` |
| `zmk.compiler` | Compiler path and arguments | Auto-detected |
| `zmk.intelliSenseMode` | IntelliSense mode | Auto-detected |
| `zmk.cppStandard` | C++ standard version | Auto-detected |

### Toolchain Configuration

ZMK supports two approaches for working with Valhalla toolchains:

1. **Local cross-compiler**: Install and configure a cross-compile toolchain on your host system
2. **DevContainer**: Work directly in a containerized Valhalla development environment

#### Option 1: Local Cross-Compiler Setup

To use a local cross-compiler, you need to install the appropriate toolchain and configure ZMK to use it.

**For Debian/Ubuntu-based distributions:**

Add the Zodiac toolchain repository and install the required tools:

```shell
echo "deb [trusted=yes] https://artifactory.zodiac.tv/artifactory/valhalla-toolchains-local toolchains main" | sudo tee /etc/apt/sources.list.d/valhalla-toolchains-local.list
sudo apt update
sudo apt install <toolchain-package-name>
```

**For other Linux distributions:**

Manually download and install the toolchain:

1. Download the required toolchain package from [Zodiac Artifactory](https://artifactory.zodiac.tv/valhalla-toolchains-local/pool/)

2. Extract the `.deb` package:

   ```shell
   ar x <toolchain-package>.deb
   tar xf data.tar.xz
   ```

3. Move the toolchain to the standard location:

   ```shell
   sudo mkdir -p /opt/toolchains
   sudo mv opt/toolchains/<gcc-toolchain-name> /opt/toolchains/
   ```

4. (Optional) Add the toolchain to your PATH:

   ```shell
   export PATH="/opt/toolchains/<gcc-toolchain-name>/bin:$PATH"
   ```

**Example:** Installing `zstbgcc-8.3.0-mipsel-uclibc-0.9.32-entone-14`:

```shell
curl -OL https://artifactory.zodiac.tv/valhalla-toolchains-local/pool/zstbgcc-8.3.0-mipsel-uclibc-0.9.32-entone-14.deb
ar x zstbgcc-8.3.0-mipsel-uclibc-0.9.32-entone-14.deb
tar xf data.tar.xz
sudo mkdir -p /opt/toolchains
sudo mv opt/toolchains/zstbgcc-8.3.0-mipsel-uclibc-0.9.32-entone-14 /opt/toolchains/
```

After installation, configure the toolchain using pattern matching (see [Advanced Toolchain Configuration](#advanced-toolchain-configuration) below).

##### Advanced Toolchain Configuration

You can configure toolchain-specific settings using pattern matching in your workspace settings:

```json
{
    "zmk.toolchain": [
        {
            "pattern": "linux-.*",
            "compiler": ["/usr/bin/g++"],
            "intelliSenseMode": "gcc-x64",
            "cppStandard": "c++17",
            "defines": {
                "CUSTOM_DEFINE": "1"
            },
            "includeDirs": ["/opt/custom/include"]
        }
    ]
}
```

**Pattern matching:** Patterns match against the compiler name format `cross_cpu[-cross_os[-cross_abi]]`. Use `*` as a wildcard for any component.

#### Option 2: DevContainer Setup

> [!Note] DevContainer support is currently under development and may not be
> available in all Valhalla projects. See the [current
> implementation](https://gerrit.zodiac.tv/c/znextgen/valhalla/+/81655)
> for status.

DevContainers rely on regular Valhalla containers to provide pre-configured
development environments with all necessary toolchains included. Three container
configurations are available:

- **Valhalla Default Platforms**: entone, emscripten, macos, and other Odido-related platforms
- **Valhalla Legacy Platforms**: c5320, humaxwb, mipsel_linux, motoastb, etc.
- **Valhalla Android Platform**: arm_android, android-apk_prebuilds

**Setup:**

1. Install the `ms-vscode-remote.remote-containers` extension
2. Open your Valhalla workspace
3. VS Code will automatically detect the available DevContainers and prompt you
   to reopen in a container
4. Select the appropriate container for your target platform
5. The workspace will reload with all cross-compilers pre-configured

When using DevContainers, toolchains are automatically configured and no manual
setup is required.

### Other Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `zmk.nfsDir` | Root of NFS image | `${buildDir}/linux/build_nfs_image/home/zodiac` |
| `zmk.bundleDir` | Bundle directory location | `${buildDir}/linux/bundles` |
| `zmk.excludeBundles` | Bundle names to exclude from includes | `[]` |
| `zmk.developer` | Developer name for copyright headers | - |
| `zmk.copyrightComment` | Copyright comment template | - |

## Using Dynamic Settings in Configuration Files

ZMK provides dynamic commands that you can use in your VS Code configuration
files. These commands automatically return current build settings.

### Available Dynamic Commands and Environment

These commands return current build settings and can be used in configuration files:

- `${command:zmk.getTargetConfig}` - Current configuration name
- `${command:zmk.getNinjaTarget}` - Current ninja target
- `${command:zmk.getRootDir}` - Root Valhalla folder
- `${command:zmk.getBuildDir}` - Build output directory
- `${command:zmk.getNfsDir}` - NFS directory
- `${command:zmk.getBundleDir}` - Bundle directory

These settings are also available as environment variables with the `zmk.` prefix:

- `${env:zmk.config}` - Current configuration name
- `${env:zmk.target}` - Current ninja target
- `${env:zmk.rootDir}` - Root Valhalla folder
- `${env:zmk.buildDir}` - Build output directory
- `${env:zmk.nfsDir}` - NFS directory
- `${env:zmk.bundleDir}` - Bundle directory

> [!Note]
>
> The dynamic setting support in VSCode not universal. For example,
> in `c_cpp_properties.json` you need to use `${env:...}` variant,
> while in `launch.json` and `tasks.json` you can use `${command:...` variant

### Example Configurations

#### tasks.json

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "Build Current Target",
            "type": "shell",
            "command": "../gnb --no-gen ${command:zmk.getTargetConfig} -- ${command:zmk.getNinjaTarget}",
            "options": {
                "cwd": "${command:zmk.getBuildDir}"
            },
            "group": {
                "kind": "build",
                "isDefault": true
            },
            "problemMatcher": {
                "base": "$gcc",
                "fileLocation": ["relative", "${command:zmk.getBuildDir}"]
            }
        }
    ]
}
```

#### c_cpp_properties.json

```json
{
    "configurations": [
        {
            "name": "Valhalla",
            "compileCommands": "${env:zmk.buildDir}/compile_commands.json",
            "includePath": [
                "${env:zmk.bundleDir}/*/include"
            ]
        }
    ]
}
```

#### launch.json

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Debug Application",
            "type": "cppdbg",
            "request": "launch",
            "program": "${command:zmk.getNfsDir}/bin/my_app",
            "cwd": "${command:zmk.getBuildDir}"
        }
    ]
}
```

## Configuration Examples

The `config-examples/` directory contains complete workspace configuration examples:

- **`appcloud/`** - AppCloud development configuration
- **`zebra/`** - Zebra component development configuration

Each example includes:
- `c_cpp_properties.json` - C++ IntelliSense configuration
- `launch.json` - Debug launch configurations
- `settings.json` - Workspace settings
- `tasks.json` - Custom build tasks

> [!Warning] Settings were renamed in v2.0:
>
> - Old Name: `extension.zmkGetTargetConfig`
> - New Name: `zmk.getTargetConfig`
>
> So the examples might carry old names yet. Feel free to fix and contribute.

## Troubleshooting

### Build Fails to Start

- **Check root directory**: Ensure `zmk.rootDir` points to a valid Valhalla
  source tree
- **Verify configuration**: Ensure `zmk.config` matches a configuration in the
  `configs/` directory
- **Check build script**: Verify that the `gnb` or `gnbc` script exists and is
  executable

### IntelliSense Not Working

- **Install C++ extension**: Ensure the VS Code C/C++ extension is installed
- **Check integration**: Verify `zmk.disableCppToolsIntegration` is `false`
- **Wait for build**: Ensure at lease the initial build has completed
  successfully, or better yet perform full build.
- **Verify compile commands**: Check that `compile_commands.json` exists in the
  build directory
- **Reset database**: Try "C/C++: Reset IntelliSense Database" command from the
  Command Palette
- **Select Valhalla Configuration Provider**: "C/C++: Change Configuration
  Provider..." and select "Valhalla".
- **Fix conflicting files**: `.vscode/c_cpp_properties.json` settings might
  conflict with automatic configuration provider and cause missing includes as
  well as other intellisense issues. Try to remove it.

### Dynamic Commands Return Empty Values

- **Wait for activation**: Ensure the extension has completed activation
- **Check workspace**: Verify your workspace contains a valid Valhalla source tree
- **Review settings**: Check that extension settings are properly configured

### Tree Views Not Updating

- **Manual refresh**: Use the refresh button in each tree view
- **Check build output**: Ensure the build completed successfully
- **Verify metadata files**: Check for `project.json` in the build directory

### Include file not found

Many components refers to the bundle's include, rather than use in-tree include.
For example SDL2 is used like that.

During minimal rebuild, bundles are not downloaded, which cause #include errors
for such components. Use reasonably wide target to download all. Good examples
might be:

- `:default` - this is full Valhalla rebuild, including unit tests
- `:valhalla` - build everything except unit tests
- `:generate_symbols` - build all the components and do not package them. Use
  with caution - might be not applicable to all targets. Although works fine for
  the legacy.

### Nothing works!

There are few ways of disabling the C++ Tools integration, keeping other parts alive

- In Settings: set `zmk.disableCppToolsIntegration: true`
- In C/C++ tool provider: `C/C++: Change Configuration Provider...` and select some other provider except "Valhalla"

## Report issues

Collect an output of

- "C/C++: Log Diagnostics"
- "OUTPUT" / "Valhalla"
- "OUTPUT" / "Valhalla Build"

## Release Notes

See [CHANGELOG.md](CHANGELOG.md) for detailed release history.

## Contributing

Interested in contributing to ZMK? See [CONTRIBUTING.md](CONTRIBUTING.md) for
development setup, architecture documentation, and contribution guidelines.

## License

See [LICENSE](LICENSE) file for details.
