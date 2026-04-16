import * as vscode from "vscode";

import { AppServiceContainer, AppServices } from "../AppServices";
import { ILMBuilder } from "../ILMBuilder";

namespace lm
{
    interface ListConfigsParameters {}

    type ListConfigsDeps = Pick<AppServices, 'context' | 'builder'>;

    export class ListConfigs implements vscode.LanguageModelTool<ListConfigsParameters>, vscode.Disposable
    {
        constructor(private deps: ListConfigsDeps)
        {
            const context = deps.context;
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
            const configs = await this.deps.builder.listConfigs();

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

    type BuildTargetToolDeps = Pick<AppServices, 'context' | 'builder'>;

    export class BuildTargetTool implements vscode.LanguageModelTool<BuildTargetParameters>, vscode.Disposable
    {
        constructor(private deps: BuildTargetToolDeps)
        {
            const context = deps.context;
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
            const success = await this.deps.builder.buildTarget(options.input.target);

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

type LMBuilderDeps = Pick<AppServices, 'context' | 'builder'>;

export function createLMBuilder(services: AppServiceContainer): LMBuilder
{
    return new LMBuilder({
        context: services.get('context'),
        builder: services.get('builder'),
    });
}

export class LMBuilder implements ILMBuilder
{
    private listConfigsTool: lm.ListConfigs;
    private buildTargetTool: lm.BuildTargetTool;

    constructor(deps: LMBuilderDeps)
    {
        this.listConfigsTool = new lm.ListConfigs(deps);
        this.buildTargetTool = new lm.BuildTargetTool(deps);
    }

}
