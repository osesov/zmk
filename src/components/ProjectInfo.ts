import * as vscode from "vscode";

// GN's project.json format is created out of existing project.json file upon a
// manual exploration, so it can be easily extended in the future if needed. For
// now, we only parse the fields required for IntelliSense configuration, but we
// can add more as needed.

export interface ProjectJsonTarget {
    type: 'action' | 'source_set' | 'group' | 'shared_library' | 'static_library' | 'executable';
    args: string[] | undefined;
    deps: string[] | undefined;
    inputs: string[] | undefined;
    metadata: { [k: string]: unknown }  | undefined; // ???
    externs: { [k: string]: unknown }  | undefined; // ???
    outputs: string[] | undefined;
    sources: string[] | undefined;
    source_outputs: { [k: string]: string[] } | undefined;
    public: string | undefined;
    public_configs: string[] | undefined;
    script: string | undefined;
    testonly: boolean | undefined;
    toolchain: string | undefined;
    visibility: string[] | undefined;
    configs: string[] | undefined;

    defines: string[] | undefined;
    include_dirs: string[] | undefined;
    cflags: string[] | undefined;
    cflags_cc: string[] | undefined;
    ldflags: string[] | undefined;
    lib_dirs: string[] | undefined;
    libs: string[] | undefined;
}

export type ProjectJsonLinkUnitType = Extract<ProjectJsonTarget['type'], 'shared_library' | 'static_library' | 'executable'>;

export interface ProjectJsonLinkUnit {
    target: string;
    type: ProjectJsonLinkUnitType;
}

interface ProjectJsonTool
{
    command: string | undefined;
    default_output_dir: string | undefined;
    default_output_extension: string | undefined;
    description: string | undefined;
    lib_dir_switch: string | undefined;
    lib_switch: string | undefined;
    output_prefix: string | undefined;
    outputs: string[] | undefined;
    framework_dir_switch: string | undefined;
    framework_switch: string | undefined;
    weak_framework_switch: string | undefined;
    depfile: string | undefined;
}

interface ProjectJsonToolchain
{
    [k: string]: ProjectJsonTool
}

export interface ProjectJsonFile {
    build_settings ?: {
        build_dir: string
        default_toolchain: string
        gen_input_files: string[]
        root_path: string
    },
    targets?: { [k: string]: ProjectJsonTarget};
    toolchains?: { [k: string]: ProjectJsonToolchain}
}


export function parseProjectJson(text: string): ProjectJsonFile
{
    // TODO: validate structure?
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === 'object' && parsed !== null) {
            return parsed as ProjectJsonFile;
        } else {
            vscode.window.showErrorMessage("Invalid project.json format: expected an object.");
            return {};
        }
    } catch (e) {
        vscode.window.showErrorMessage("Failed to parse project.json: " + e);
        return {};
    }
}
