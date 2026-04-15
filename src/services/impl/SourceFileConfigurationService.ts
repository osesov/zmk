import * as vscode from 'vscode';

import { ISourceFileConfigurationService } from "../ISourceFileConfigurationService";
import { CompilerStandard, IntelliSenseMode, MutableSourceFileConfiguration, MutableWorkspaceBrowseConfiguration } from '../../components/SourceFileConfiguration';
import { IProjectInfoService } from '../IProjectInfoService';
import { ICompileCommandsService } from '../ICompileCommandsService';
import { AppServiceContainer } from '../AppServices';
import { ISettingsService, Setting } from '../ISettingsService';
import { IBuilderService } from '../IBuilderService';

export class SourceFileConfigurationService implements ISourceFileConfigurationService
{
    private sourceFileConfigurationChanged = new vscode.EventEmitter<void>();
    public readonly onDidChangeSourceFileConfiguration = this.sourceFileConfigurationChanged.event;

    private browseConfigurationChanged = new vscode.EventEmitter<void>();
    public readonly onDidChangeBrowseConfiguration = this.browseConfigurationChanged.event;

    private providedSourceFileConfiguration = new vscode.EventEmitter<{ uri: vscode.Uri, configuration: MutableSourceFileConfiguration | null }>();
    public readonly onDidProvidedSourceFileConfiguration = this.providedSourceFileConfiguration.event;

    private settings: ISettingsService;
    private projectInfo: IProjectInfoService;
    private compileCommands: ICompileCommandsService;
    private builder: IBuilderService;

    constructor(services: AppServiceContainer) {
        this.settings = services.get('settings');
        this.projectInfo = services.get('projectInfo');
        this.compileCommands = services.get('compileCommands');
        this.builder = services.get('builder');

        const initialBuild = services.get('initialBuild');

        initialBuild.then(() => {
            this.projectInfo.onChange(() => {
                this.sourceFileConfigurationChanged.fire();
                this.browseConfigurationChanged.fire();
            });

            this.compileCommands.onChange(() => {
                this.sourceFileConfigurationChanged.fire();
            });

            this.settings.onChange(event => {
                if (event.affects(Setting.browseTargets)) {
                    this.browseConfigurationChanged.fire();
                }
            });
        });
    }

    public async getSourceFileConfiguration(uri: vscode.Uri): Promise<MutableSourceFileConfiguration | undefined | null> {

        let entry = this.getFromCompileCommands(uri);
        if (!entry)
            entry = this.getFromProjectInfo(uri);

        if (!entry)
            return null;

        entry = await this.enrich(entry);

        this.providedSourceFileConfiguration.fire({ uri, configuration: entry });
        return entry;
    }

    private getFromCompileCommands(uri: vscode.Uri): MutableSourceFileConfiguration | null
    {
        return this.compileCommands.getSourceFileConfiguration(uri);
    }

    private getFromProjectInfo(uri: vscode.Uri): MutableSourceFileConfiguration | null
    {
        const target = this.projectInfo.getSourceFileConfiguration(uri, this.compileCommands.cxxCompiler);
        return target ?? null;
    }

    private async enrich(info: MutableSourceFileConfiguration): Promise<MutableSourceFileConfiguration>
    {
        const compilerArgs = this.settings.get(Setting.compiler);
        const intelliSenseMode = this.settings.get(Setting.intelliSenseMode);
        const result = Object.assign({}, info);

        // going to modify defines array, so make a copy to avoid mutating original configuration
        result.defines = [...result.defines];

        const includeDirs = this.settings.get(Setting.includeDirs)
        if (includeDirs && includeDirs.length > 0)
            result.includePath = [...includeDirs, ...result.includePath]
        const defines = this.settings.get(Setting.defines);
        if (defines) {
            for (const [name, value] of Object.entries(defines)) {
                result.defines = result.defines.filter(d => !(d === name || d.startsWith(`${name}=`)));
                if (value !== null) {
                    result.defines.push(`${name}=${value}`);
                }
            }
        }

        if (compilerArgs && compilerArgs.length > 0 && !result.compilerPath) {
            result.compilerPath = compilerArgs[0];
            result.compilerArgs = compilerArgs.slice(1);
        }

        if (intelliSenseMode && !result.intelliSenseMode) {
            result.intelliSenseMode = intelliSenseMode as IntelliSenseMode;
        }

        const toolchain = await this.builder.toolchain()
        if (toolchain) {
            if (!result.compilerPath && toolchain.compiler && toolchain.compiler.length > 0) {
                result.compilerPath = toolchain.compiler[0];
                result.compilerArgs = toolchain.compiler.slice(1);
            }

            if (toolchain.intelliSenseMode && !result.intelliSenseMode) {
                result.intelliSenseMode = toolchain.intelliSenseMode as IntelliSenseMode;
            }

            if (toolchain.cppStandard && !result.standard) {
                result.standard = toolchain.cppStandard as CompilerStandard;
            }

            if (toolchain.includeDirs && toolchain.includeDirs.length > 0) {
                result.includePath = [...toolchain.includeDirs, ...result.includePath];
            }

            // toolchain defines should override settings defines, which should override original configuration defines
            if (toolchain.defines) {
                for (const [name, value] of Object.entries(toolchain.defines)) {
                    result.defines = result.defines.filter(d => !(d === name || d.startsWith(`${name}=`)));
                    if (value !== null) {
                        result.defines.push(`${name}=${value}`);
                    }
                }
            }
        }

        return result;
    }

    public async getBrowseConfiguration(): Promise<MutableWorkspaceBrowseConfiguration | null>
    {
        const browseConfig = this.projectInfo.getBrowseConfiguration();
        if (!browseConfig) {
            return null;
        }

        return {
            browsePath: browseConfig.browsePath,
            standard: browseConfig.standard,
            compilerPath: browseConfig.compilerPath,
            compilerArgs: browseConfig.compilerArgs
        };
    }

    getDependenciesForSourceFile(uri: vscode.Uri): string[] | null
    {
        return this.projectInfo.getDependenciesForSourceFile(uri);
    }
}
