import * as child_process from 'child_process';
import * as vscode from 'vscode';

export class Interactions
{
    private process: child_process.ChildProcessWithoutNullStreams | null = null;
    private lines: string[] = [];
    private resolve: ((line: string) => void) | null = null;
    private reject: ((error: any) => void) | null = null;

    constructor(private cmdLine: string[], private spawnOptions: child_process.SpawnOptions, private outputChannel: vscode.OutputChannel)
    {
    }

    start()
    {
        return new Promise<void>((resolve, reject) => {
            const isWindows = process.platform === 'win32';
            if (this.process)
            {
                throw new Error('Process is already running');
            }

            this.outputChannel.appendLine(`Starting process: ${this.cmdLine.join(' ')}`);

            this.process = child_process.spawn(this.cmdLine[0], this.cmdLine.slice(1), {
                ...this.spawnOptions,
                detached: isWindows ? false : true,
                stdio: ["pipe", "pipe", "pipe"]
            });

            let buffer = '';
            this.process.stdout.on('data', (data) => {
                buffer += data.toString();

                while (true) {
                    const pos = buffer.indexOf('\n');
                    if (pos === -1) {
                        break;
                    }

                    const line = buffer.substring(0, pos).trim();
                    buffer = buffer.substring(pos + 1);
                    this.outputChannel.appendLine(`line: ${line}`);

                    this.lines.push(line);
                    if (this.resolve) {
                        this.resolve(this.lines.shift()!);
                        this.resolve = null;
                        this.reject = null;
                    }
                }
            });

            this.process.on('error', (err) => {
                this.outputChannel.appendLine(`Process error: ${err.message}`);
                if (this.reject) {
                    this.reject(err);
                    this.resolve = null;
                    this.reject = null;
                }
            });

            this.process.on('spawn', () => {
                this.outputChannel.appendLine(`Process started with PID ${this.process?.pid}`);
                resolve();
            });

            this.process.on('exit', (code, signal) => {
                this.outputChannel.appendLine(`Process exited with code ${code} and signal ${signal}`);
                if (this.reject) {
                    this.reject(new Error(`Process exited with code ${code} and signal ${signal}`));
                    this.resolve = null;
                    this.reject = null;
                }
            });

            this.process.on('close', (code, signal) => {
                this.outputChannel.appendLine(`Process closed with code ${code} and signal ${signal}`);
                if (this.reject) {
                    this.reject(new Error(`Process closed with code ${code} and signal ${signal}`));
                    this.resolve = null;
                    this.reject = null;
                }
            });
        });
    }

    stop()
    {
        if (!this.process)
        {
            throw new Error('Process is not running');
        }

        const proc = this.process;
        this.process = null;

        if (proc.pid) {
            const isWindows = process.platform === 'win32';
            console.log(`Killing process group with PID ${proc.pid}`);
            if (isWindows) {
                child_process.exec(`taskkill /PID ${proc.pid} /T /F`);
            }
            else {
                process.kill(-proc.pid, 'SIGTERM');
            }
        }
    }

    sendInput(input: string)
    {
        if (!this.process)
        {
            throw new Error('Process is not running');
        }

        this.process.stdin.write(input + '\n');
    }

    async readLine(): Promise<string>
    {
        if (this.lines.length > 0)
        {
            return this.lines.shift()!;
        }

        return new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
    }

    async waitLine(predicate: (line: string) => boolean, timeout: number = 5000): Promise<string>
    {
        return new Promise(async (resolve, reject) => {

            let timeoutHandle: NodeJS.Timeout | null = null;
            timeoutHandle = setTimeout(() => {
                if (this.reject) {
                    this.reject(new Error('Timeout waiting for line'));
                    this.resolve = null;
                    this.reject = null;
                }
            }, timeout);

            while (true)
            {
                const line = await this.readLine();
                if (predicate(line))
                {
                    if (timeoutHandle) {
                        clearTimeout(timeoutHandle);
                    }
                    return line;
                }
            }
        });
    }

}
