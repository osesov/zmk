import path from "path";
import fs from "fs";
import vscode from "vscode";
import shell from "shell-quote";
import * as cpptools from "vscode-cpptools";
import { isDevContainerHost, Mutable } from "./utils";
import { build } from "./constants";

type ArgValue = string | boolean | number
type ArgMap = Map<string, ArgValue>

function parseArgs(text: string): ArgMap
{
    // simplified args.gn parsing, only supports simple key=value pairs, no lists, values are single-line.
    // Format follows `gn/gnb_config_parser.py`

    const result: ArgMap = new Map();

    const re = /^\s*(?<name>[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:(?<string>["]([\\].|[^\\"])*?["])|(?<number>\d+)|(?<boolean>true|false))\s*$/u;

    for (const line of text.split('\n')) {
        const eqIndex = line.indexOf('=');
        if (line.trimStart().startsWith('#') || eqIndex < 1) {
            continue; // skip comments and invalid lines
        }

        const match = re.exec(line);
        if (!match) {
            continue; // skip lines that don't match the regex
        }

        const { name, string, number, boolean: bool } = match.groups!;
        if (string !== undefined) {
            result.set(name, JSON.parse(string));
        } else if (number !== undefined) {
            result.set(name, parseInt(number, 10));
        } else if (bool !== undefined) {
            result.set(name, bool === 'true');
        }
    }

    return result;
}

export class ArgsFile
{
    private values: ArgMap = new Map();
    private mtime: number = 0;
    private argsFile: string | null = null;

    public reset(): void {
        this.values.clear();
        this.mtime = 0;
        this.argsFile = null;
    }

    public load(outputDir: string | null | undefined): boolean {
        if (!outputDir) {
            return false;
        }
        const argsFile = path.join(outputDir, 'args.gn');
        if (!fs.existsSync(argsFile)) {
            vscode.window.showErrorMessage(`Failed to find args.gn in ${outputDir}. Make sure the build was successful and that the output directory is correct.`);
            return false;
        }

        const file = fs.openSync(argsFile, 'r');
        try {
            const stats = fs.fstatSync(file);
            const mtime = stats.mtime.getTime();
            if (mtime === this.mtime && argsFile === this.argsFile) {
                return true;
            }

            const content = fs.readFileSync(file, 'utf-8');
            this.values = parseArgs(content);
            this.mtime = mtime;
            this.argsFile = argsFile;

            return true;
        }

        finally {
            fs.closeSync(file);
        }
    }

    public get<T extends ArgValue>(name: string): T | undefined {
        return this.values.get(name) as T | undefined;
    }
}
