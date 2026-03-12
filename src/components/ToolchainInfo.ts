import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { isDevContainerHost } from './utils';

// TODO: Loading toolchain's includes from container doesn't work quite right.
// TODO: Load args from valhalla? `args.gn` file or
// `./gn/gnb_config_parser.py --config ./configs/zodiac-entone5xx-sfw-prd.yaml --args`
// This can be used to support cross-compiler toolchain, running on host

interface ToolchainInfoJson
{
    compiler: string
    includeDirs: string[]
    defines: { [key: string]: string }
    env: { [key: string]: string }
}

export class ToolchainInfo
{

    private mtime: number = 0;
    private toolchainInfoPath: string | null = null;
    private toolchainInfo: ToolchainInfoJson | null = null;

    public reset()
    {
        this.mtime = 0;
        this.toolchainInfoPath = null;
        this.toolchainInfo = null;
    }

    public async load(outputDir: string | null, toolchainFile: string | null | undefined): Promise<ToolchainInfoJson | null>
    {
        if (isDevContainerHost())
            return null;

        if (!toolchainFile)
            return null;

        const toolchainInfoPath = outputDir ? path.join(outputDir, toolchainFile) : toolchainFile;
        if (!fs.existsSync(toolchainInfoPath)) {
            vscode.window.showErrorMessage(`Failed to find ${toolchainFile} in ${outputDir}. Make sure the build was successful and that the output directory is correct.`);
            return null;
        }

        const file = fs.openSync(toolchainInfoPath, 'r');
        try {
            const stats = fs.fstatSync(file);
            const mtime = stats.mtime.getTime();
            if (mtime === this.mtime && toolchainInfoPath === this.toolchainInfoPath) {
                return this.toolchainInfo;
            }

            const content = fs.readFileSync(file, 'utf-8');
            const toolchainInfo = JSON.parse(content) as ToolchainInfoJson;
            this.toolchainInfo = toolchainInfo;
            this.mtime = mtime;
            this.toolchainInfoPath = toolchainInfoPath;
            return toolchainInfo;
        }

        finally {
            fs.closeSync(file);
        }
    }

    public getIncludeDirs(): string[]
    {
        if (!this.toolchainInfo || !this.toolchainInfoPath)
            return [];

        const dir = path.dirname(this.toolchainInfoPath);
        return this.toolchainInfo.includeDirs
            .filter( e => typeof e === "string")
            .map( e => e.startsWith("/") ? e.substring(1) : e)
            .map( e => e.replaceAll("/", path.sep))
            .map( e => path.resolve(dir + path.sep + e) )
    }
}
