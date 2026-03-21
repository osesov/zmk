import * as vscode from 'vscode';
import { AppServiceContainer } from '../services/AppServices';
import { Setting } from '../services/ISettingsService';
import { IValhallaTaskProvider } from '../services/IValhallaTaskProvider';
import { BuildCommand, BuildCommandOptions, BuildMode, IBuilderService } from '../services/IBuilderService';
import { assertNever } from './utils';

export const gnbTaskType = 'gnb';
interface ValhallaTaskDefinition extends vscode.TaskDefinition, BuildCommandOptions {
    type: typeof gnbTaskType;
    label: string;
}

export class ValhallaTaskProvider implements vscode.TaskProvider, IValhallaTaskProvider
{
    constructor(private services: AppServiceContainer)
    {
        const context = services.get('context');
        context.subscriptions.push(vscode.tasks.registerTaskProvider(gnbTaskType, this));
    }

    public async provideTasks(token: vscode.CancellationToken): Promise<vscode.Task[]> {

        const settings = this.services.get('settings');
        const builder = this.services.get('builder');
        const tasks: vscode.Task[] = [];
        const taskDefinition: ValhallaTaskDefinition = {
            type: gnbTaskType,
            label: '',
            command: undefined,
            mode: undefined,
            config: settings.get(Setting.config),
            target: settings.get(Setting.target),
            gnbFlags: settings.get(Setting.gnbFlags),
            gnFlags: settings.get(Setting.gnFlags),
            env: {},
        };

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
        const logOutputChannel = this.services.get('logOutputChannel');
        logOutputChannel.info(`Resolving task: ${task.name} ${JSON.stringify(task.definition)}`);
        if (task.definition.type !== gnbTaskType) {
            return null;
        }

        const builder = this.services.get('builder');
        const taskDefinition = task.definition as ValhallaTaskDefinition;
        const buildCommand = await builder.getBuildCommand(taskDefinition);

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
        workspaceFolder: vscode.WorkspaceFolder,
        title: string,
        builder: IBuilderService,
        buildKind: BuildMode,
        taskDefinitionTemplate: ValhallaTaskDefinition,
        multipleWorkspaceFolders: boolean
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
            }
            return `Build using target ${actualTarget}`;
        }

        const buildCommand = await builder.getBuildCommand(taskDefinitionTemplate, buildKind);

        if (!buildCommand || buildCommand.command.length == 0)
            return;

        const taskDefinition = Object.assign({}, taskDefinitionTemplate);

        taskDefinition.label = multipleWorkspaceFolders ? `${workspaceFolder.name}: ${title}` : title;
        taskDefinition.mode = buildKind;

        // build command
        const task = new vscode.Task(
            taskDefinition,
            workspaceFolder,
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

        default:
            assertNever(buildCommand.actualBuildMode);
        }

        task.presentationOptions = {
            clear: true
        }
        task.detail = getDetails(buildCommand);
        tasks.push(task);
    }
}
