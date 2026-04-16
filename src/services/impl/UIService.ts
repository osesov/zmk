import * as vscode from 'vscode';
import { AppServiceContainer, AppServices } from "../AppServices";
import { IUIService } from "../IUIService";
import { ISettingsService, Setting } from '../ISettingsService';
import { zmkCommand } from '../../components/constants';
import { extractPart, extractRange, groupBy, stripParts } from '../../components/utils';
import { getCurrentFile } from '../../components/oldies';
import { BuildMode } from '../IBuilderService';
import { parseTarget } from '../../components/parseTarget';

type UIServiceDeps = Pick<AppServices, 'context' | 'settings' | 'buildOutputChannel' | 'builder' | 'projectInfo' | 'testController'>;

export function createUIService(services: AppServiceContainer): UIService
{
    return new UIService({
        context: services.get('context'),
        settings: services.get('settings'),
        buildOutputChannel: services.get('buildOutputChannel'),
        builder: services.get('builder'),
        projectInfo: services.get('projectInfo'),
        testController: services.get('testController'),
    });
}

export class UIService implements IUIService
{
    private readonly settings: ISettingsService;
    private readonly buildOutputChannel: vscode.OutputChannel;
    private readonly builder: AppServices['builder'];
    private readonly projectInfo: AppServices['projectInfo'];
    private readonly testController: AppServices['testController'];

    constructor(deps: UIServiceDeps)
    {
        this.settings = deps.settings;
        this.buildOutputChannel = deps.buildOutputChannel;
        this.builder = deps.builder;
        this.projectInfo = deps.projectInfo;
        this.testController = deps.testController;
        const context = deps.context;

        context.subscriptions.push(
            vscode.commands.registerCommand(zmkCommand.showOutput, () => {
                this.buildOutputChannel.show();
            }),
        );

        context.subscriptions.push(
            vscode.commands.registerCommand(zmkCommand.setConfig, async () => this.setConfigCommand()),
            vscode.commands.registerCommand(zmkCommand.selectValhallaProject, async () => this.selectValhallaProject()),
            vscode.commands.registerCommand(zmkCommand.selectAndBuildTarget, async () => this.selectAndBuildTarget()),
            vscode.commands.registerCommand(zmkCommand.selectAndRunTest, async () => this.selectAndRunTest())
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
        const settings = this.settings;
        if (!settings.get(Setting.isValhallaProject)) {
            vscode.window.showErrorMessage('Current workspace is not a Valhalla project.');
            return;
        }
        const configs = await this.builder.listConfigs();

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
        type TargetQuickPickItem = vscode.QuickPickItem & { target ?: string };

        const valhallaFolder = this.settings.get(Setting.valhallaFolder);
        const target = this.settings.get(Setting.target);

        if (!valhallaFolder)
            return;

        const linkUnits = this.projectInfo.getLinkUnits();
        const currentFileUri = await this.getCurrentFile(valhallaFolder);
        const fileLinkUnits = currentFileUri ? this.projectInfo.getLinkUnitsForFile(currentFileUri) : null;
        const unitTests = this.projectInfo.getUnitTests();
        const currentFileToBuild = getCurrentFile();
        const allUnitTests = this.testController.getTests();

        // prepare quick pick items
        const tasks: TargetQuickPickItem[] = [];

        tasks.push({ label: '--- Known targets ---', kind: vscode.QuickPickItemKind.Separator });
        tasks.push({ label: 'Build All', target: undefined });
        if (target) {
            tasks.push({ label: `Build ${target}`, target });
        }
        if (fileLinkUnits && fileLinkUnits.length > 0) {
            tasks.push({ label: `Build Current File`, target: currentFileToBuild + '^' });
        }
        tasks.push({ label: 'Minimal Build', target: 'empty' });

        if (fileLinkUnits && fileLinkUnits.length > 0) {
            tasks.push({ label: '--- Targets related to current file ---', kind: vscode.QuickPickItemKind.Separator });
            for (const linkUnit of fileLinkUnits) {
                tasks.push({ label: linkUnit.target, description: linkUnit.type, target: linkUnit.target });
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

            tasks.push({ label: linkUnit.target, description: linkUnit.type, target: linkUnit.target });
        }

        if (unitTests && unitTests.length > 0) {
            tasks.push({ label: '--- In config unit tests ---', kind: vscode.QuickPickItemKind.Separator });
            for (const unitTest of unitTests ?? []) {
                tasks.push({ label: unitTest, description: 'unit test', target: unitTest });
            }
        }

        if (allUnitTests && allUnitTests.length > 0) {
            tasks.push({ label: '--- All unit tests ---', kind: vscode.QuickPickItemKind.Separator });
            for (const test of allUnitTests) {
                tasks.push({ label: test, description: 'unit test', target: test });
            }
        }

        await vscode.window.showQuickPick(tasks, { placeHolder: 'Select a target to build' })
        .then(async selection => {
            if (selection) {
                await this.builder.buildTarget(selection.target);
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

    private async selectAndRunTest(): Promise<void>
    {
        const tests = this.testController.getTests();

        if (!tests || tests.length === 0) {
            vscode.window.showInformationMessage('No tests found in the current project.');
            return;
        }

        type TestQuickPickItem = vscode.QuickPickItem & { testId: string };
        const items: TestQuickPickItem[] = [];
        let folder = '';

        for (const test of tests) {
            const parsed = parseTarget(test, false);

            if (!parsed) {
                continue;
            }

            const testId = test;
            const name = parsed.pathParts[parsed.pathParts.length - 1];
            const path = parsed.pathParts.slice(0, -1).join('/');

            const item: TestQuickPickItem = { label: path + " > " + name, testId };
            items.push(item);
        }

        const selection = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a test to run',
            canPickMany: true,
            matchOnDescription: true,
        });
        if (selection) {
            await this.testController.runTests(selection.map(s => s.testId));
        }
    }
}
