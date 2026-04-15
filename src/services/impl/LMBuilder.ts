import * as vscode from "vscode";

import { AppServiceContainer } from "../AppServices";
import { ILMBuilder } from "../ILMBuilder";

namespace lm
{
    interface ListConfigsParameters {}

    export class ListConfigs implements vscode.LanguageModelTool<ListConfigsParameters>, vscode.Disposable
    {
        constructor(private services: AppServiceContainer)
        {
            const context = services.get('context');
            context.subscriptions.push(this,
                vscode.lm.registerTool('valhalla-list-configs', this)
            );
        }

        dispose(): void
        {
        }

        async prepareInvocation(
            options: vscode.LanguageModelToolInvocationPrepareOptions<ListConfigsParameters>,
            token: vscode.CancellationToken
        ): Promise<vscode.PreparedToolInvocation>
        {
            return {
                invocationMessage: 'Listing available configurations...'
            };
        }

        async invoke(
            options: vscode.LanguageModelToolInvocationOptions<ListConfigsParameters>,
            token: vscode.CancellationToken
        ): Promise<vscode.LanguageModelToolResult>
        {
            const builder = this.services.get('builder');
            const configs = await builder.listConfigs();

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Available configs:\n${configs.map(c => `- ${c}`).join('\n')}`
                )
            ]);
        }
    }

    interface BuildTargetParameters {
        target: string | undefined;
    }

    export class BuildTargetTool implements vscode.LanguageModelTool<BuildTargetParameters>, vscode.Disposable
    {
        constructor(private services: AppServiceContainer)
        {
            const context = services.get('context');
            context.subscriptions.push(this,
                vscode.lm.registerTool('valhalla-build-target', this)
            );
        }

        dispose(): void
        {
        }

        async prepareInvocation(
            options: vscode.LanguageModelToolInvocationPrepareOptions<BuildTargetParameters>,
            token: vscode.CancellationToken
        ): Promise<vscode.PreparedToolInvocation>
        {
            return {
                invocationMessage: `Building target ${options.input.target ?? '(default)'}...`
            };
        }

        async invoke(
            options: vscode.LanguageModelToolInvocationOptions<BuildTargetParameters>,
            token: vscode.CancellationToken
        ): Promise<vscode.LanguageModelToolResult>
        {
            const builder = this.services.get('builder');
            const success = await builder.buildTarget(options.input.target);

            if (success.success) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(
                        `Build succeeded for target ${options.input.target ?? '(default)'}!`
                    )
                ]);
            }

            return new vscode.LanguageModelToolResult([
                new vscode.LanguageModelTextPart(
                    `Build failed for target ${options.input.target ?? '(default)'}.\nStatus: ${success.status}\nOutput:\n${success.output.join('\n')}`
                )
            ]);
        }
    }
}

export class LMBuilder implements ILMBuilder
{
    private listConfigsTool: lm.ListConfigs;
    private buildTargetTool: lm.BuildTargetTool;

    constructor(private services: AppServiceContainer)
    {
        this.listConfigsTool = new lm.ListConfigs(services);
        this.buildTargetTool = new lm.BuildTargetTool(services);
    }

}
