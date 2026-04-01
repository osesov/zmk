import * as vscode from 'vscode';
import { AppServiceContainer } from "../AppServices";
import { ITestController } from "../ITestController";
import { BuildTargetOptions } from '../IBuilderService';

export class TestController implements ITestController
{
    private readonly controller: vscode.TestController;

    constructor(private services: AppServiceContainer)
    {
        const context = services.get('context');
        const projectInfo = services.get('projectInfo');
        const builder = services.get('builder');
        this.controller = vscode.tests.createTestController('valhallaTestController', 'Valhalla Tests');

        context.subscriptions.push(this.controller);

        this.controller.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, async (request, token) => {
            const run = this.controller.createTestRun(request);
            try {
                for (const test of request.include ?? []) {
                    // const testMessages: vscode.TestMessage[] = [];
                    // const appendMessage = (message: string) => {
                    //     const testMessage = new vscode.TestMessage(message);
                    //     testMessages.push(testMessage);
                    //     run.appendOutput(message + '\r\n', test);
                    // }
                    run.started(test);

                    run.appendOutput(`Building test target ${test.id}...\r\n`);
                    const options: BuildTargetOptions = {
                        onStdout: (data) => run.appendOutput(`[STDOUT] ${data}\r\n`, undefined, test),
                        onStderr: (data) => run.appendOutput(`[STDERR] ${data}\r\n`, undefined, test),
                    };
                    const result = await builder.buildTarget(test.id, options);
                    run.appendOutput(`Build result for test target ${test.id}: ${result.success ? 'Success' : 'Failure'}\r\n`);

                    if (!result.success) {
                        run.failed(test, new vscode.TestMessage('Failed to build test target'));
                    } else {
                        run.passed(test);
                    }
                }
            } finally {
                run.end();
            }
        });

        // this.controller.createRunProfile('Debug Tests', vscode.TestRunProfileKind.Debug, (request, token) => {
        //     const run = this.controller.createTestRun(request);
        //     run.end();
        // });

        projectInfo.onChange(() => this.refreshTests());
        this.refreshTests();
    }

    private async refreshTests(): Promise<void>
    {
        const projectInfo = this.services.get('projectInfo');
        const unitTests = projectInfo.getUnitTests();

        this.controller.items.replace([]);
        if (!unitTests) {
            return;
        }

        for (const test of unitTests ?? []) {
            const testItem = this.controller.createTestItem(test, test);
            this.controller.items.add(testItem);
        }
    }
}
