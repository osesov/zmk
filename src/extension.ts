import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { QuickPickItem } from 'vscode';

function exists(file: string): boolean {
	return fs.existsSync(file);
}

function findProjectRoot(p: string) : string {
	while(true) {
		let file = path.resolve(p, ".gn");

		if (exists(file)) {
				return p;
		}

		let n = path.dirname(p);

		if (p === n) {
				throw new Error("Path not found");
		} else {
				p = n;
		}
	}
}

function findProjectRootInWorkspace() : string {
	let configuration = vscode.workspace.getConfiguration();

	const workspaceRoot = vscode.workspace.rootPath;
	if (workspaceRoot === undefined) {
		throw Error("no workspaceRoot");
	}

	return findProjectRoot(workspaceRoot);
}

async function listConfigs() : Promise<string[]> {
	const rootDir: string | undefined = getRootDir();
	if (rootDir === undefined) {
		return [];
	}

	let configDir = path.resolve(rootDir, "configs");

	return new Promise<string[]>((resolve, _reject) => {
			fs.readdir( configDir, (err, files) => {
					let result : string[] = [];

					files.forEach( file => {
							if (file.endsWith(".yaml") && fs.statSync(path.resolve(configDir, file)).isFile()) {
									console.log(`File: ${file}`);
									result.push(file.substr(0,file.length-5));
							}
					});

					resolve(result);
			});
	});
}

async function showCurrentConfig() {
	let configuration = vscode.workspace.getConfiguration();

	const currentConfig = configuration.get('zmk.config');
	const currentTarget = configuration.get('zmk.target');

	vscode.window.showInformationMessage(`Config: ${currentConfig},`);
	vscode.window.showInformationMessage(`Target: ${currentTarget}`);
}

class ConfigItem implements QuickPickItem {
	label: string;

	constructor(label: string) {
		this.label = label;
	}
}

async function updateConfig() {
	let configuration = vscode.workspace.getConfiguration();

	const quickPick = vscode.window.createQuickPick();
	const options = await listConfigs();
	const current = configuration.get('zmk.config');


	const pick = vscode.window.createQuickPick<ConfigItem>();
	pick.placeholder = "type gnb config name here";
	pick.items = options.map( label => new ConfigItem(label));
	pick.activeItems = pick.items.filter( item => item.label === current );
	pick.onDidAccept( async () => {
		if (pick.selectedItems.length !== 1) {
			pick.dispose();
			return;
		}

		const result = pick.selectedItems[0].label;
		pick.dispose();

		console.log(`Selected ${result}`);
		vscode.window.showInformationMessage(`Selected: ${result}`);

		await configuration.update("zmk.config", result, vscode.ConfigurationTarget.Workspace);
		console.log(`new config is ${configuration.get("zmk.config")}`);
	});

	pick.show();
}

function getOrDefault(setting: string, defValue : ((setting ?: string) => string) | string ): string {
	let configuration = vscode.workspace.getConfiguration();
	const config = configuration.get(setting);
	let value : string | undefined = undefined;

	if (config !== undefined && config !== null && config !== "") {
		value = <string>config;
	} else if (typeof(defValue) === 'function') {
		value = defValue(setting);
	} else {
		value = defValue;
	}

	console.log( `get: ${setting} -> ${value}` );
	return value;
}

function getTargetConfig(): string {
	return getOrDefault("zmk.config", "zodiac-pc_linux-zebra-dev");
}

function getNinjaTarget(): string {
	return getOrDefault("zmk.target", "");
}

function getRootDir(): string {
	return getOrDefault("zmk.rootDir", findProjectRootInWorkspace);
}

function getBuildDir(): string {
	return getOrDefault("zmk.buildDir", () => {
		return path.resolve(getRootDir(), `out.${getTargetConfig()}`);
	});
}

function getNfsDir(): string {
	return getOrDefault("zmk.nfsDir", () => {
		return path.resolve(getBuildDir(), "linux/build_nfs_image/home/zodiac");
	});
}

function getCurrentFile(): string {
	let editor = vscode.window.activeTextEditor;
	if (editor === undefined) {
		return "";
	}

	let currentFile = editor.document.fileName;

	let currentFileRelative = path.relative( getBuildDir(), currentFile);
	return currentFileRelative;
}

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Extension "zmk" is active');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json

	const commands = [
		{ label: 'zmkConfig', command: updateConfig },
		{ label: 'zmkGetTargetConfig', command: getTargetConfig },
		{ label: 'zmkGetNinjaTarget', command: getNinjaTarget },
		{ label: 'zmkGetRootDir', command: getRootDir },
		{ label: 'zmkGetBuildDir', command: getBuildDir },
		{ label: 'zmkGetNfsDir', command: getNfsDir },
		{ label: 'zmkGetCurrentFile', command: getCurrentFile },
		{ label: 'showCurrentZmkConfig', command: showCurrentConfig}
	];

	commands.forEach( (elem) => {
		let disposable = vscode.commands.registerCommand(`extension.${elem.label}`, elem.command);
		context.subscriptions.push(disposable);
	});

}

// this method is called when your extension is deactivated
export function deactivate() {}
