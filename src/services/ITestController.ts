export interface ITestController
{
    getTests(): string[] | null;
    runTests(ids: string[]): Promise<void>;
}
