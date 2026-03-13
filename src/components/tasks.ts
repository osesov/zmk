import * as vscode from 'vscode';
import { ServiceContainer } from '../services/ServiceContainer';
import { AppServices } from '../services/AppServices';
import { Setting } from '../services/ISettingsService';
import { IValhallaTaskProvider } from '../services/IValhallaTaskProvider';
import { BuildKind, IBuilderService } from '../services/IBuilderService';
import { assertNever } from './utils';

export const gnbTaskType = 'gnb';
interface ValhallaTaskDefinition extends vscode.TaskDefinition {
    type: typeof gnbTaskType;
    label: string;
    config ?: string;
    target ?: string;
    gnbFlags ?: string[];
    gnFlags ?: string[];
    env: { [k: string]: string | undefined | null}
}

export class ValhallaTaskProvider implements vscode.TaskProvider, IValhallaTaskProvider
{
    constructor(private services: ServiceContainer<AppServices>)
    {
        const context = services.get('context');
        context.subscriptions.push(vscode.tasks.registerTaskProvider(gnbTaskType, this));
    }

    public provideTasks(token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task[]> {

        const settings = this.services.get('settings');
        const builder = this.services.get('builder');
        const tasks: vscode.Task[] = [];
        const taskDefinition: ValhallaTaskDefinition = {
            type: gnbTaskType,
            label: '',
            config: settings.get(Setting.config),
            target: settings.get(Setting.target),
            gnbFlags: settings.get(Setting.gnbFlags),
            gnFlags: settings.get(Setting.gnFlags),
            env: {},
        };

        const multipleWorkspaceFolders = (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 1) ?? false;

        for (const workspaceFolder of vscode.workspace.workspaceFolders ?? []) {
            this.createBuildCommand(tasks, workspaceFolder, 'Build', builder, BuildKind.build, taskDefinition, multipleWorkspaceFolders);
            this.createBuildCommand(tasks, workspaceFolder, 'Clean build', builder, BuildKind.clean, taskDefinition, multipleWorkspaceFolders);
            this.createBuildCommand(tasks, workspaceFolder, 'Deep clean build', builder, BuildKind.deepClean, taskDefinition, multipleWorkspaceFolders);
            this.createBuildCommand(tasks, workspaceFolder, 'Minimal build', builder, BuildKind.buildEmpty, taskDefinition, multipleWorkspaceFolders);
        }
        return tasks;
    }

    public resolveTask(task: vscode.Task, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task> {
        if (task.definition.type === gnbTaskType) {
            const builder = this.services.get('builder');
            const taskDefinition = task.definition as ValhallaTaskDefinition;
            const buildCommand = builder.getBuildCommand(taskDefinition);

            if (!buildCommand || buildCommand.command.length === 0) {
                return undefined;
            }

            const newTask = new vscode.Task(
                taskDefinition,
                vscode.TaskScope.Workspace,
                task.name,
                gnbTaskType,
                new vscode.ProcessExecution(
                    buildCommand.command[0], buildCommand.command.slice(1), {
                    cwd: buildCommand.cwd,
                    env: buildCommand.env
                })
            );

            newTask.group = vscode.TaskGroup.Build;
            return newTask;
        }
        return undefined;
    }

    private createBuildCommand(
        tasks: vscode.Task[],
        workspaceFolder: vscode.WorkspaceFolder,
        title: string,
        builder: IBuilderService,
        buildKind: BuildKind,
        taskDefinitionTemplate: ValhallaTaskDefinition,
        multipleWorkspaceFolders: boolean
    )
    {
        const buildCommand = builder.getBuildCommand(taskDefinitionTemplate, buildKind);

        if (!buildCommand || buildCommand.command.length == 0)
            return;

        const taskDefinition = Object.assign({}, taskDefinitionTemplate);

        taskDefinition.label = multipleWorkspaceFolders ? `${workspaceFolder.name}: ${title}` : title;

        // build command
        const task = new vscode.Task(
            taskDefinition,
            workspaceFolder,
            `${title} (${taskDefinition.config} | ${buildCommand.actualTarget ?? "default"})`,
            gnbTaskType,
            new vscode.ProcessExecution(buildCommand.command[0], buildCommand.command.slice(1), {
                cwd: buildCommand.cwd,
                env: buildCommand.env
            })
        );
        switch (buildKind) {
        case undefined:
        case BuildKind.build:
        case BuildKind.buildEmpty:
            task.group = vscode.TaskGroup.Build;
            break;

        case BuildKind.clean:
            task.group = vscode.TaskGroup.Clean;
            break;

        case BuildKind.deepClean:
            task.group = vscode.TaskGroup.Rebuild;
            break;

        default: assertNever(buildKind);
        }

        task.presentationOptions = {
            clear: true
        }
        task.problemMatchers = [];
        task.detail = `Target: ${buildCommand.actualTarget ?? "default"}`;
        tasks.push(task);
    }
}
