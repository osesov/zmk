import * as vscode from 'vscode';
import { AppServices } from "../AppServices";
import { IUIService } from "../IUIService";
import { ServiceContainer } from "../ServiceContainer";
import { Setting } from '../ISettingsService';
import { BuildConstants, zmkCommand } from '../../components/constants';
import { extractPart, extractRange, groupBy, stripParts } from '../../components/utils';

export class UIService implements IUIService
{
    constructor(private services: ServiceContainer<AppServices>)
    {
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
    }

    private async setConfigCommand(): Promise<void>
    {
        const settings = this.services.get('settings');
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
}
