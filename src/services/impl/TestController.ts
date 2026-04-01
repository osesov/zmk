import * as vscode from 'vscode';
import { AppServiceContainer } from "../AppServices";
import { ITestController } from "../ITestController";
import { BuildMode, BuildResult, BuildTargetOptions } from '../IBuilderService';
import { ISettingsService, Setting } from '../ISettingsService';
import { FileWatcher } from '../../components/FileWatcher';
import { parseProjectJson, ProjectInfoManager, ProjectJsonFile } from '../../components/ProjectInfo';
import { parseTarget } from '../../components/parseTarget';

export class TestController implements ITestController
{
    private readonly controller: vscode.TestController;
    private readonly tests: Map<string, vscode.TestItem> = new Map();
    private readonly settings: ISettingsService;
    private readonly fileWatcher = new FileWatcher("project.json");
    private projectJson: ProjectJsonFile | null = null;
    private readonly runProfile: vscode.TestRunProfile;

    constructor(private services: AppServiceContainer)
    {
        const context = services.get('context');
        this.controller = vscode.tests.createTestController('valhallaTestController', 'Valhalla Tests');

        context.subscriptions.push(this.controller);

        this.runProfile = this.controller.createRunProfile('Run Tests', vscode.TestRunProfileKind.Run, async (request, token) => {
            await this.runTestsImpl(request)
        });

        // this.controller.createRunProfile('Debug Tests', vscode.TestRunProfileKind.Debug, (request, token) => {
        //     const run = this.controller.createTestRun(request);
        //     run.end();
        // });


        /// Tests

        this.settings = services.get('settings');

        const resetFile = async () => {
            const outputDir = this.settings.get(Setting.testOutputDir);
            this.fileWatcher.setBaseDir(outputDir);

            const content = await this.fileWatcher.getContentAsync()
            this.projectJson = content ? parseProjectJson(content) : null;

            await this.refreshTests();
        }

        this.settings.onChange(() => resetFile());
        vscode.workspace.onDidChangeWorkspaceFolders(() => resetFile());
        this.fileWatcher.onChange(() => resetFile());

        resetFile();

        ///
        this.refreshTests();
    }

    getTests(): string[] | null
    {
        return Array.from(this.tests.keys());
    }

    async runTests(ids: string[]): Promise<void>
    {
        const tests = ids.map(id => this.tests.get(id)).filter((item): item is vscode.TestItem => !!item);
        const request = new vscode.TestRunRequest(tests);
        await this.runTestsImpl(request)
    }

    private addFlatTestsAsHierarchy(
        controller: vscode.TestController,
        tests: string[],
    )
    {
        const suiteIndex = new Map<string, vscode.TestItem>();

        for (const test of tests) {
            let parentCollection: vscode.TestItemCollection = controller.items;
            let parentIdPrefix = '';

            const parsed = parseTarget(test, false)
            const path = parsed?.pathParts;
            if (!path) {
                continue;
            }

            for (let i = 0; i < path.length - 1; i++) {
                const segment = path[i];
                const suiteId = parentIdPrefix ? `${parentIdPrefix}/${segment}` : segment;

                let suite = suiteIndex.get(suiteId);
                if (!suite) {
                    suite = controller.createTestItem(suiteId, segment);
                    suiteIndex.set(suiteId, suite);
                    parentCollection.add(suite);
                }

                parentCollection = suite.children;
                parentIdPrefix = suiteId;
            }

            const leafName = path[path.length - 1];
            const leafId = test;

            const leaf = controller.createTestItem(leafId, leafName);
            this.tests.set(test, leaf);

            parentCollection.add(leaf);
        }
    }

    private async refreshTests(): Promise<void>
    {
        const unitTests = ProjectInfoManager.getUnitTests(this.projectJson);

        this.controller.items.replace([]);
        this.tests.clear();
        if (!unitTests) {
            return;
        }

        this.addFlatTestsAsHierarchy(this.controller, unitTests);

        // for (const test of unitTests ?? []) {
        //     const testItem = this.controller.createTestItem(test, test);
        //     this.controller.items.add(testItem);
        //     this.tests.set(test, testItem);
        // }
    }


    private async runTest(testId: string, run: vscode.TestRun, test: vscode.TestItem): Promise<BuildResult>
    {
        // return { success: true, status: null, output: [] };

        const builder = this.services.get('builder');
        const options: BuildTargetOptions = {
            onStdout: (data) => run.appendOutput(`[STDOUT] ${data}\r\n`, undefined, test),
            onStderr: (data) => run.appendOutput(`[STDERR] ${data}\r\n`, undefined, test),
            buildMode: BuildMode.test,
        };
        run.appendOutput(`Starting test ${test.id}...\r\n`);
        const result = await builder.buildTarget(testId, options);
        run.appendOutput(`Build result for test target ${testId}: ${result.success ? 'Success' : 'Failure'}\r\n`, undefined, test);
        return result
    }


    private async runTestsImpl(request: vscode.TestRunRequest): Promise<void>
    {
        const run = this.controller.createTestRun(request);
        try {
            const testsToRun = request.include ? request.include : Array.from(this.controller.items).map(([_, item]) => item);
            const queue: vscode.TestItem[] = [];

            const enqueueTests = (items: readonly vscode.TestItem[]) => {
                items.forEach(test => {
                    if (test.children.size > 0) {
                        enqueueTests(Array.from(test.children).map(([_, item]) => item));
                    } else {
                        queue.push(test);
                    }
                });
            }

            enqueueTests(testsToRun);

            for (const test of queue) {
                run.enqueued(test);
            }

            for (const test of queue) {
                run.started(test);

                const result = await this.runTest(test.id, run, test);
                if (!result.success) {
                    run.failed(test, new vscode.TestMessage('Failed to build test target'));
                } else {
                    run.passed(test);
                }
            }
        }
        finally {
            run.end();
        }
    }
}
