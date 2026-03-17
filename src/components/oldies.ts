import path from "path";
import fs from "fs";

import * as vscode from "vscode";
import { findProjectRootInWorkspace, hasWorkspace } from "./utils";

export function getOrDefault(setting: string, defValue : ((setting ?: string) => string) | string ): string {
    const configuration = vscode.workspace.getConfiguration();
    const config = configuration.get(setting);
    let value : string | undefined = undefined;

    if (config !== undefined && config !== null && config !== "") {
        value = <string>config;
    } else if (typeof(defValue) === 'function') {
        value = defValue(setting);
    } else {
        value = defValue;
    }

    console.log( `get: ${setting} -> ${value}` );
    return value;
}

export function getTargetConfig(): string {
    return getOrDefault("zmk.config", "zodiac-pc_linux-zebra-dev");
}

export function getNinjaTarget(): string {
    return getOrDefault("zmk.target", "");
}

export function getRootDir(): string {
    return getOrDefault("zmk.rootDir", findProjectRootInWorkspace);
}

export function getBuildDir(): string {
    return getOrDefault("zmk.buildDir", () => path.resolve(getRootDir(), `out.${getTargetConfig()}`));
}

export function getBuildDirAndCreate(): string {
    const dir = getBuildDir();
    fs.mkdirSync(dir, {recursive: true})
    return dir
}

export function getBundleDir(): string {
    return getOrDefault("zmk.bundleDir", () => {
        return path.resolve(getBuildDir(), "linux", "bundles");
    });
}

export function getNfsDir(): string {
    return getOrDefault("zmk.nfsDir", () => {
        return path.resolve(getBuildDir(), "linux/build_nfs_image/home/zodiac");
    });
}

export function getCurrentFile(): string {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
        return "";
    }

    const currentFile = editor.document.fileName;

    const currentFileRelative = path.relative( getBuildDir(), currentFile);
    return currentFileRelative;
}

//
// function exports zmk settings to environment, since cpptools has no support for ${command:extension.xxx}
// instead in c_cpp_properties use %{env:xxx}
//
export function updateCurrentEnvironment()
{
    const values : { [key:string]: () => string } = {
        'zmk.config': getTargetConfig,
        'zmk.target': getNinjaTarget,
        'zmk.rootDir': getRootDir,
        'zmk.buildDir': getBuildDir,
        'zmk.nfsDir': getNfsDir,
        'zmk.bundleDir': getBundleDir,
    };

    let item;
    if (!hasWorkspace()) {
        Object.keys(values)
        .forEach( item => delete process.env[item]);
        return;
    }

    for (item in values) {
        const value = values[item]();
        if (!value) {
            delete process.env[item];
        }
        else
        {
            process.env[item] = value;
        }
    }
}
