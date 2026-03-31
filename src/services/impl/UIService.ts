import * as vscode from 'vscode';
import { AppServiceContainer } from "../AppServices";
import { IUIService } from "../IUIService";
import { ISettingsService, Setting } from '../ISettingsService';
import { zmkCommand } from '../../components/constants';
import { extractPart, extractRange, groupBy, stripParts } from '../../components/utils';

export class UIService implements IUIService
{
    private readonly settings: ISettingsService;

    constructor(private services: AppServiceContainer)
    {
        this.settings = this.services.get('settings');
        const context = this.services.get('context');

        context.subscriptions.push(
            vscode.commands.registerCommand(zmkCommand.showOutput, () => {
                const outputChannel = this.services.get('buildOutputChannel');
                outputChannel.show();
            }),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(zmkCommand.setConfig, async () => this.setConfigCommand())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(zmkCommand.selectValhallaProject, async () => this.selectValhallaProject())
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(zmkCommand.selectAndBuildTarget, async () => this.selectAndBuildTarget())
        );

        this.settings.onChange(e => {
            if (e.affects(Setting.workspaceFolders)) {
                this.workspaceFoldersChanged();
            }
        });

        this.workspaceFoldersChanged();
    }

    private async setConfigCommand(): Promise<void>
    {
        const settings = this.services.get('settings');
        if (!settings.get(Setting.isValhallaProject)) {
            vscode.window.showErrorMessage('Current workspace is not a Valhalla project.');
            return;
        }
        const builder = this.services.get('builder');
        const configs = await builder.listConfigs();

        type MyQuickPickItem = vscode.QuickPickItem & { configs: string[] };
        const quickPick = vscode.window.createQuickPick<MyQuickPickItem>();
        const msoGroups = groupBy(configs, e => extractPart(e, 0));

        // create quick pick items with group labels
        return new Promise<string[]>((resolve) => {

            const items: MyQuickPickItem[] = [];
            for (const [groupName, groupItems] of Object.entries(msoGroups)) {
                items.push({ label: `--- ${groupName} ---`, kind: vscode.QuickPickItemKind.Separator, configs: [] });
                const subConfigs = groupBy(groupItems, e => extractRange(e, 0, 3));

                for (const [configName, nestedConfigs] of Object.entries(subConfigs)) {
                    const devModes = stripParts(nestedConfigs, 3).join(', ');
                    items.push({label: configName, configs: nestedConfigs, description: devModes});
                }
            }

            quickPick.items = items;
            quickPick.value = extractRange(settings.get(Setting.config) ?? '', 0, 3);
            quickPick.placeholder = 'Select a config';
            quickPick.onDidChangeSelection(async selection => {
                if (selection[0] && selection[0].kind !== vscode.QuickPickItemKind.Separator) {
                    quickPick.hide();
                    resolve(selection[0].configs);
                }
            });
            quickPick.show();
        })
        .then(async selectedConfigs => {
            const selectedVariant = await vscode.window.showQuickPick(selectedConfigs, { placeHolder: 'Select a config variant' });
            if (selectedVariant) {
                await settings.update(Setting.config, selectedVariant);
            }
        })
        ;

    }

    private async workspaceFoldersChanged(): Promise<void>
    {
        const workspaceFolders = this.settings.get(Setting.valhallaProjects);

        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        if (workspaceFolders.length <= 1)
            return;

        const activeProject = this.settings.get(Setting.activeProject);

        workspaceFolders.find(folder => folder.uri.fsPath === activeProject)?.uri;

        const projectNames = workspaceFolders.join(', ');
        const selectButton = 'Select Valhalla Project';
        const skipButton = 'Skip';

        const result = await vscode.window.showWarningMessage(`Multiple Valhalla projects found in workspace: ${projectNames}.`, selectButton, skipButton);

        if (result === selectButton) {
            vscode.commands.executeCommand(zmkCommand.selectValhallaProject);
        }
    }

    private async selectValhallaProject(): Promise<void>
    {
        const valhallaProjects = this.settings.get(Setting.valhallaProjects);
        if (!valhallaProjects || valhallaProjects.length === 0) {
            vscode.window.showErrorMessage('No Valhalla projects found in workspace. Please open a workspace with a Valhalla project for the extension to work.');
            return;
        }

        const items = valhallaProjects.map(folder => ({ label: folder.name, uri: folder.uri }));
        const selection = await vscode.window.showQuickPick(items, { placeHolder: 'Select a Valhalla project' });
        if (selection) {
            await this.settings.updateWorkspaceState(Setting.activeProject, selection.uri.fsPath);
        }
    }

    private async selectAndBuildTarget(): Promise<void>
    {
        const valhallaFolder = this.settings.get(Setting.valhallaFolder);

        if (!valhallaFolder)
            return;

        const projectInfo = this.services.get('projectInfo');
        const linkUnits = projectInfo.getLinkUnits();
        const currentFile = await this.getCurrentFile(valhallaFolder);
        const fileLinkUnits = currentFile ? projectInfo.getLinkUnitsForFile(currentFile) : null;

        // prepare quick pick items
        const tasks: vscode.QuickPickItem[] = [];
        if (fileLinkUnits && fileLinkUnits.length > 0) {
            tasks.push({ label: '--- Targets related to current file ---', kind: vscode.QuickPickItemKind.Separator });
            for (const linkUnit of fileLinkUnits) {
                tasks.push({ label: linkUnit.target, description: linkUnit.type });
            }
        }

        let haveOtherTargets = false;
        for (const linkUnit of linkUnits) {
            if (fileLinkUnits && fileLinkUnits.find(u => u.target === linkUnit.target))
                continue;

            if (!haveOtherTargets) {
                tasks.push({ label: '--- Other targets ---', kind: vscode.QuickPickItemKind.Separator });
                haveOtherTargets = true;
            }

            tasks.push({ label: linkUnit.target, description: linkUnit.type });
        }

        await vscode.window.showQuickPick(tasks, { placeHolder: 'Select a target to build' })
        .then(async selection => {
            if (selection) {
                const targetName = selection.label;
                const builder = this.services.get('builder');
                await builder.buildTarget(targetName);
            }
        });
    }

    private async getCurrentFile(valhallaFolder: vscode.Uri): Promise<vscode.Uri | null>
    {
        const fileUri = vscode.window.activeTextEditor?.document.uri;
        if (!fileUri || !valhallaFolder) {
            return null;
        }

        // should be relative to valhalla dir, if not inside return null
        if (!fileUri.fsPath.startsWith(valhallaFolder.fsPath)) {
            return null;
        }

        return fileUri;
    }
}
