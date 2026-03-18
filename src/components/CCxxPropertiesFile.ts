import path from "path";
import fs from "fs";
import * as vscode from "vscode";

// update c_cpp_properties.json file

import { AppServiceContainer } from "../services/AppServices"
import { getWorkspaceRoot } from "./utils"
import { getBundleDir } from "./oldies";
import { Setting } from "../services/ISettingsService";

interface CCxxPropertiesConfiguration
{
    name: string
    includePath: string[]
    defines: string[]
    compilerPath: string
    cppStandard: string
    cStandard: string
    intelliSenseMode: string
}

interface CCXXPropertiesFile
{
    version: 4,
    configurations: CCxxPropertiesConfiguration[]
}

export function zmkUpdateBundlesInclude(services: AppServiceContainer)
{
    const isValhallaProject = services.get('settings').get(Setting.isValhallaProject);
    if (!isValhallaProject) {
        vscode.window.showWarningMessage('Current workspace is not a Valhalla project.');
        return;
    }
    const workspaceRoot = getWorkspaceRoot();
    if (workspaceRoot === undefined) {
        throw Error("no workspaceRoot");
    }

    const configuration = vscode.workspace.getConfiguration();
    const skipBundles : Array<string> = configuration.get("zmk.excludeBundles") || [];
    const configFileName  = path.resolve(workspaceRoot, ".vscode", "c_cpp_properties.json");

    if (!fs.existsSync(configFileName)) {
        vscode.window.showWarningMessage(`c_cpp_properties.json file not found at ${configFileName}.`);
        return;
    }

    const fileData = fs.readFileSync(configFileName, 'utf8');
    const configData = JSON.parse(fileData) as CCXXPropertiesFile;

    const bundleDir = getBundleDir();

    if (!fs.existsSync(bundleDir)) {
        throw new Error(`Bundle path not found: ${bundleDir}`);
    }

    const includes = fs.readdirSync(bundleDir, { withFileTypes: true })
        .filter(item => item.isDirectory())
        .filter(item => !!skipBundles.indexOf(item.name))
        .filter(item => {
            const includeDir = path.resolve(bundleDir, item.name, "include");
            return fs.existsSync(includeDir) && fs.statSync(includeDir).isDirectory();
        })
        .map( item =>
            path.join("${env:zmk.bundleDir}", item.name, "include" ))
        ;

    if (configData && Array.isArray(configData.configurations)) {

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configData.configurations.forEach((config : any, index : number) => {
            const includePath : Array<string> = config["includePath"];
            if (!includePath) {
                return;
            }

            const otherIncludes = includePath.filter((item) =>
                !item.startsWith("${env:zmk.bundleDir}")
            );

            const newIncludePath = otherIncludes.concat(includes);
            // console.log(newIncludePath);

            configData.configurations[index]["includePath"] = newIncludePath;
        });

        const newConfigData = JSON.stringify(configData, null, 4);

        services.get('review').reviewTextDocument(
            vscode.Uri.file(configFileName),
            newConfigData,
            "Review changes to c_cpp_properties.json"
        );
    }
}
