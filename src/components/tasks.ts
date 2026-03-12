import * as vscode from 'vscode';
import { ServiceContainer } from '../services/ServiceContainer';
import { AppServices } from '../services/AppServices';
import { Setting } from '../services/ISettingsService';
import { IValhallaTaskProvider } from '../services/IValhallaTaskProvider';

export const gnbTaskType = 'gnb';
interface ValhallaTaskDefinition extends vscode.TaskDefinition {
    type: typeof gnbTaskType;
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
            config: settings.get(Setting.config),
            target: settings.get(Setting.target),
            gnbFlags: settings.get(Setting.gnbFlags),
            gnFlags: settings.get(Setting.gnFlags),
            env: {},
        };

        const buildCommand = builder.getBuildCommand(taskDefinition);
        if (buildCommand && buildCommand.command.length > 0) {
            const task = new vscode.Task(
                taskDefinition,
                vscode.TaskScope.Workspace,
                `GNB (${taskDefinition.config} | ${taskDefinition.target ?? "default"})`,
                gnbTaskType,
                new vscode.ProcessExecution(buildCommand.command[0], buildCommand.command.slice(1), {
                    cwd: buildCommand.cwd,
                    env: buildCommand.env
                })
            );
            task.group = vscode.TaskGroup.Build;
            tasks.push(task);
        }
        return tasks;
    }

    public resolveTask(task: vscode.Task, token: vscode.CancellationToken): vscode.ProviderResult<vscode.Task> {
        if (task.definition.type === gnbTaskType) {
            const builder = this.services.get('builder');
            const taskDefinition = <ValhallaTaskDefinition>task.definition;
            const buildCommand = builder.getBuildCommand(taskDefinition);

            if (!buildCommand || buildCommand.command.length === 0) {
                return undefined;
            }

            const task = new vscode.Task(
                taskDefinition,
                vscode.TaskScope.Workspace,
                `GNB (${taskDefinition.config} | ${taskDefinition.target ?? "default"})`,
                gnbTaskType,
                new vscode.ProcessExecution(
                    buildCommand.command[0], buildCommand.command.slice(1), {
                    cwd: buildCommand.cwd,
                    env: buildCommand.env
                })
            );

            task.group = vscode.TaskGroup.Build;
            return task;
        }
        return undefined;
    }
}
