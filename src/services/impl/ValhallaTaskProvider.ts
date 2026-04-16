import * as vscode from 'vscode';
import { AppServiceContainer, AppServices } from '../AppServices';
import { ISettingsService, Setting } from '../ISettingsService';
import { IValhallaTaskProvider } from '../IValhallaTaskProvider';
import { BuildCommand, BuildCommandOptions, BuildMode, IBuilderService } from '../IBuilderService';
import { assertNever, expectNever } from '../../components/utils';

export const gnbTaskType = 'gnb';
interface ValhallaTaskDefinition extends vscode.TaskDefinition, BuildCommandOptions {
    type: typeof gnbTaskType;
    label: string;
}

type ValhallaTaskProviderDeps = Pick<AppServices, 'context' | 'settings' | 'builder' | 'logOutputChannel'>;

export function createValhallaTaskProvider(services: AppServiceContainer): ValhallaTaskProvider
{
    return new ValhallaTaskProvider({
        context: services.get('context'),
        settings: services.get('settings'),
        builder: services.get('builder'),
        logOutputChannel: services.get('logOutputChannel'),
    });
}

export class ValhallaTaskProvider implements vscode.TaskProvider, IValhallaTaskProvider
{
    private readonly settings: ISettingsService;
    private readonly builder: IBuilderService;
    private readonly logOutputChannel: vscode.LogOutputChannel;

    constructor(deps: ValhallaTaskProviderDeps)
    {
        this.settings = deps.settings;
        this.builder = deps.builder;
        this.logOutputChannel = deps.logOutputChannel;
        deps.context.subscriptions.push(vscode.tasks.registerTaskProvider(gnbTaskType, this));
    }

    public async provideTasks(token: vscode.CancellationToken): Promise<vscode.Task[]> {

        const builder = this.builder;
        const tasks: vscode.Task[] = [];
        const taskDefinition: ValhallaTaskDefinition = {
            type: gnbTaskType,
            label: '',
            command: undefined,
            mode: undefined,
            config: this.settings.get(Setting.config),
            target: this.settings.get(Setting.target),
            gnbFlags: this.settings.get(Setting.gnbFlags),
            gnFlags: this.settings.get(Setting.gnFlags),
            env: {},
        };

        if (!this.settings.get(Setting.isValhallaProject)) {
            return [];
        }

        const valhallaFolder = this.settings.get(Setting.valhallaFolder);

        const multipleWorkspaceFolders = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) ?? false;

        for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
            await this.createBuildCommand(tasks, workspaceFolder, 'Build', builder, BuildMode.build, taskDefinition, multipleWorkspaceFolders);
            await this.createBuildCommand(tasks, workspaceFolder, 'Build All', builder, BuildMode.buildAll, taskDefinition, multipleWorkspaceFolders);
            await this.createBuildCommand(tasks, workspaceFolder, 'Build Current File', builder, BuildMode.buildCurrentFile, taskDefinition, multipleWorkspaceFolders);
            await this.createBuildCommand(tasks, workspaceFolder, 'Clean build', builder, BuildMode.clean, taskDefinition, multipleWorkspaceFolders);
            await this.createBuildCommand(tasks, workspaceFolder, 'Deep clean build', builder, BuildMode.deepClean, taskDefinition, multipleWorkspaceFolders);
            await this.createBuildCommand(tasks, workspaceFolder, 'Minimal build', builder, BuildMode.buildEmpty, taskDefinition, multipleWorkspaceFolders);
        }
        return tasks;
    }

    public async resolveTask(task: vscode.Task, token: vscode.CancellationToken): Promise<vscode.Task | null> {
        const logOutputChannel = this.logOutputChannel;
        logOutputChannel.info(`Resolving task: ${task.name} ${JSON.stringify(task.definition)}`);
        if (task.definition.type !== gnbTaskType) {
            return null;
        }

        const taskDefinition = task.definition as ValhallaTaskDefinition;
        const buildCommand = await this.builder.getBuildCommand(taskDefinition);

        if (!buildCommand || buildCommand.command.length === 0) {
            logOutputChannel.error(`Cannot resolve task ${task.name}: no build command available.`);
            return null;
        }

        logOutputChannel.info(`Creating resolved task ${task.name}: ${buildCommand.command.join(' ')}`);

        // Create a NEW task with the original definition preserved
        const execution = new vscode.ProcessExecution(
            buildCommand.command[0],
            buildCommand.command.slice(1),
            {
                cwd: buildCommand.cwd,
                env: buildCommand.env
            }
        );

        const resolvedTask = new vscode.Task(
            taskDefinition,  // Preserve original task definition
            task.scope ?? vscode.TaskScope.Workspace,
            task.name,
            gnbTaskType,
            execution,
            task.problemMatchers ?? []
        );

        resolvedTask.group = task.group ?? vscode.TaskGroup.Build;
        resolvedTask.detail = task.detail;

        logOutputChannel.info(`Task ${task.name} resolved successfully.`);
        return resolvedTask;
    }

    private async createBuildCommand(
        tasks: vscode.Task[],
        scope: vscode.WorkspaceFolder | vscode.TaskScope,
        title: string,
        builder: IBuilderService,
        buildKind: BuildMode,
        taskDefinitionTemplate: ValhallaTaskDefinition,
        multipleWorkspaceFolders: boolean,
        detailOverride?: string,
    )
    {
        const getDetails = (buildCommand: BuildCommand): string => {
            const actualTarget = buildCommand.actualTarget ?? "[not specified]";
            switch (buildCommand.actualBuildMode) {
                case BuildMode.build:
                    return `Build user target ${actualTarget}`;

                case BuildMode.buildAll:
                    return `Build all components. Using target ${actualTarget}`;

                case BuildMode.buildEmpty:
                    return `Build minimal. Using target ${actualTarget}`;

                case BuildMode.clean:
                    return `Clean and Build using target ${actualTarget}`;

                case BuildMode.deepClean:
                    return `Deep clean and Build using target ${actualTarget}`;

                case BuildMode.buildCurrentFile:
                    return `Build current file. Using target ${actualTarget}`;

                case BuildMode.test:
                    return `Run tests. Using target ${actualTarget}`;

                default:
                    expectNever(buildCommand.actualBuildMode);
            }
            return `Build using target ${actualTarget}`;
        }

        const buildCommand = await builder.getBuildCommand(taskDefinitionTemplate, buildKind);

        if (!buildCommand || buildCommand.command.length == 0)
            return;

        const taskDefinition = Object.assign({}, taskDefinitionTemplate);
        const workspaceFolderName = typeof scope === 'object' && 'name' in scope ? scope.name : undefined;

        taskDefinition.label = multipleWorkspaceFolders && workspaceFolderName ? `${workspaceFolderName}: ${title}` : title;
        taskDefinition.mode = buildKind;

        // build command
        const task = new vscode.Task(
            taskDefinition,
            scope,
            `${title} (${taskDefinition.config} | ${buildCommand.actualTarget ?? "not set"})`,
            gnbTaskType,
            new vscode.ProcessExecution(buildCommand.command[0], buildCommand.command.slice(1), {
                cwd: buildCommand.cwd,
                env: buildCommand.env
            }),
            [ "$gnb" ]
        );
        switch (buildCommand.actualBuildMode) {
        case undefined:
        case BuildMode.build:
        case BuildMode.buildEmpty:
        case BuildMode.buildAll:
        case BuildMode.buildCurrentFile:
            task.group = vscode.TaskGroup.Build;
            break;

        case BuildMode.clean:
            task.group = vscode.TaskGroup.Clean;
            break;

        case BuildMode.deepClean:
            task.group = vscode.TaskGroup.Rebuild;
            break;

        case BuildMode.test:
            task.group = vscode.TaskGroup.Test;
            break;

        default:
            assertNever(buildCommand.actualBuildMode);
        }

        task.presentationOptions = {
            clear: true
        }
        task.detail = detailOverride ?? getDetails(buildCommand);
        tasks.push(task);
    }
}
