import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { QuickPickItem, TextEditor, TextEditorEdit } from 'vscode';
import { URL } from 'url';

const zmkDocumentScheme = 'zmkdoc';

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

function hasWorkspace(): boolean {
	const workspaceRoot = vscode.workspace.rootPath;
	return workspaceRoot !== undefined;
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

	vscode.window.showInformationMessage(`Config: ${currentConfig}`);
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

function getBundleDir(): string {
	return getOrDefault("zmk.bundleDir", () => {
		return path.resolve(getBuildDir(), "linux", "bundles");
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

//
// function exports zmk settings to environment, since cpptools has no support for ${command:extension.xxx}
// instead in c_cpp_properties use %{env:xxx}
//
function updateCurrentEnvironment()
{
	const values : { [key:string]: () => string } = {
		'zmk.config': getTargetConfig,
		'zmk.target': getNinjaTarget,
		'zmk.rootDir': getRootDir,
		'zmk.buildDir': getBuildDir,
		'zmk.nfsDir': getNfsDir,
		'zmk.bundleDir': getBundleDir,
	};

	var item;
	if (!hasWorkspace()) {
		Object.keys(values)
		.forEach( item => delete process.env[item]);
		return;
	}

	for (item in values) {
		const value = values[item]();
		if (!value) {
			delete process.env[item];
		}
		else
		{
			process.env[item] = value;
		}
	}
}

// update c_cpp_properties.json file

function zmkUpdateBundlesInclude() {
	const workspaceRoot = vscode.workspace.rootPath;
	if (workspaceRoot === undefined) {
		throw Error("no workspaceRoot");
	}

	const configuration = vscode.workspace.getConfiguration();
	const skipBundles : Array<string> = configuration.get("zmk.excludeBundles") || [];
	var configFileName  = path.resolve(workspaceRoot, ".vscode", "c_cpp_properties.json");

	if (!fs.existsSync(configFileName)) {
		return;
	}

	var fileData = fs.readFileSync(configFileName, 'utf8');
	var configData = JSON.parse(fileData);

	var bundleDir = getBundleDir();

	if (!fs.existsSync(bundleDir)) {
		throw new Error(`Bundle path not found: ${bundleDir}`);
	}

	var includes = fs.readdirSync(bundleDir, { withFileTypes: true })
		.filter(item => item.isDirectory())
		.filter(item => !!skipBundles.indexOf(item.name))
		.filter(item => {
			var includeDir = path.resolve(bundleDir, item.name, "include");
			return fs.existsSync(includeDir) && fs.statSync(includeDir).isDirectory();
		})
		.map( item =>
			path.join("${env:zmk.bundleDir}", item.name, "include" ))
		;

	if (configData && Array.isArray(configData.configurations)) {

		configData.configurations.forEach((config : any, index : number) => {
			var includePath : Array<string> = config["includePath"];
			if (!includePath) {
				return;
			}

			var otherIncludes = includePath.filter((item) =>
				!item.startsWith("${env:zmk.bundleDir}")
			);

			var newIncludePath = otherIncludes.concat(includes);
			console.log(newIncludePath);

			configData.configurations[index]["includePath"] = newIncludePath;
		});

		var newConfigData = JSON.stringify(configData, null, 4);

		const Ok = "Ok";
		const ShowConfig = "Show new config";
		const Cancel = "Cancel";

		vscode.window
		.showWarningMessage("Override 'c_cpp_properties.json' file? This would lose comments if any.", Ok, ShowConfig, Cancel)
		.then( (outcome) => {
			console.log(outcome);

			switch(outcome) {
				case Ok:
					var oldFileName = configFileName + ".old";
					if (!fs.existsSync(oldFileName)) {
						fs.renameSync(configFileName, oldFileName);
					}
					fs.writeFileSync(configFileName, newConfigData, 'utf8');
					break;
				case ShowConfig:
					let uri = vscode.Uri.parse(zmkDocumentScheme + ":Virtual document: c_cpp_properties.json?" + newConfigData);
					vscode.workspace.openTextDocument(uri)
					.then( (doc) =>
						vscode.window.showTextDocument(doc),
					(error) =>
						console.log(error)
					);
					break;

			}
		});
	}

}

type Comment = { begin:string, end:string, prefix: string };

function comment(b: string, i: string, e: string) : Comment
{
	var c: Comment = {
		begin: b, prefix: i, end: e
	};

	return c;
}
const languages : { [key:string]: Comment } = {
	'cpp': comment("/*", " *", "*/"),
};

function formatDate(date: Date) {
    var month = '' + (date.getMonth() + 1);
    var day = '' + date.getDate();
    var year = date.getFullYear();

    if (month.length < 2) {
		month = '0' + month;
	}

    if (day.length < 2) {
		day = '0' + day;
	}

    return [year, month, day].join('-');
}

function escapeRegexpSpecials(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

function matchCopyrightComment(doc: vscode.TextDocument) : vscode.Range | null {

	/* first comment and check if word "copyright" is here */
	const commentPattern = new RegExp("[ \t]*/[*]((?:[^*]|[*][^/])*)[*]/[ \t]*[\n]?|(?:[ \t]*//[^\\n]+[\\n])+", "g");
	const copyrightPattern = new RegExp("copyright|mozilla public|public domain", "i");

	const text = doc.getText();
	const match = commentPattern.exec(text);

	if (!match) {
		return null;
	}

	const matchedComment = match[0];

	if (!copyrightPattern.test(matchedComment)) {
		return null;
	}

	const matchBegin = match.index;
	const matchEnd = match.index + match[0].length;

	const b = doc.positionAt(matchBegin);
	const e = doc.positionAt(matchEnd);

	if (b.line >= 50) { // comment should start in the first 50 lines
		return null;
	}

	return new vscode.Range(b, e);
}

function findInsertionPoint(doc: vscode.TextDocument) : vscode.Position | null
{
	// it seems better to insert licence at the very beginning
	return null;

/*
	const re = new RegExp(
		"^([ \\t]*#[ \\t]*ifndef.*[\\n][ \\t]*#[ \\t]*define.*\\n)", "g");

	const match = re.exec(doc.getText());
	if (!match) {
		return null;
	}

	return doc.positionAt(match.index + match[0].length);
*/
}

function zmkUpdateCopyright(editor: TextEditor, edit: TextEditorEdit) {
	const defaultComment = [
		"Copyright (C) @YEAR@ Zodiac Systems Inc",
		"",
		"@developer @DEVELOPER@",
		"",
		"Proprietary and Confidential.",
		"Unauthorized distribution or copying is prohibited.",
		"All rights reserved.",
		"",
		"No part of this computer software may be reprinted, reproduced or utilized",
		"in any form or by any electronic, mechanical, or other means, now known or",
		"hereafter invented, including photocopying and recording, or using any",
		"information storage and retrieval system, without permission in writing",
		"from Zodiac Systems Inc.",
	].join('\n');

	var lang_id = editor.document.languageId;
	if (lang_id !== "cpp") {
		vscode.window.showWarningMessage("Language is not supported");
		return;
	}

	const comment = languages[lang_id];
	if (!comment) {
		vscode.window.showWarningMessage("Unknown document language");
		return;
	}

	const developer = getOrDefault("zmk.developer", "");
	const template = getOrDefault("zmk.copyrightComment", defaultComment);
	const date = new Date();
	const currentYear = date.getFullYear().toString();
	const currentDate = formatDate(date);

	const document = editor.document;
	const range = matchCopyrightComment(document);

	var commentText = template
		.replace("@DEVELOPER@", developer)
		.replace("@YEAR@", currentYear)
		.replace("@DATE@", currentDate)
		;

	var lines = "/*\n"
		+ commentText
			.split('\n')
			.map( line => (line.length === 0 ? ' *' : ` * ${line}`) )
			.join('\n')
			+ "\n"
		+ " */\n";

	if (range !== null) {
		edit.replace(range, lines);
	}
	else {
		var position = findInsertionPoint(document);
		if (position === null) {
			position = new vscode.Position(0,0);
		}

		const textLine = document.lineAt(position.line);

		if (position.line > 0) {
			lines = "\n" + lines;
		}

		if (!textLine.isEmptyOrWhitespace) {
			lines = lines + "\n";
		}

		edit.insert(position, lines);
	}
}

var askCopyrightHeader = true;

function checkCopyrightHeader(document: vscode.TextDocument)
{
	if (!askCopyrightHeader) {
		return;
	}

	var lang_id = document.languageId;

	if (lang_id !== "cpp") {
		return;
	}

	if (matchCopyrightComment(document) !== null) {
		return;
	}

	const ok = "Ok";
	const no_ask = "Do not ask"
	vscode.window.showWarningMessage("Document has no Copyright header, insert?", ok, no_ask)
		.then( action => {
			if (action === ok) {
				vscode.commands.executeCommand("extension.zmkUpdateCopyright");
			}
			else if (action === no_ask) {
				askCopyrightHeader = false;
			}
		});
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
		{ label: 'showCurrentZmkConfig', command: showCurrentConfig},
		{ label: 'zmkUpdateBundlesInclude', command: zmkUpdateBundlesInclude }
	];

	const textCommands = [
		{ label: 'zmkUpdateCopyright', command: zmkUpdateCopyright }
	];

	commands.forEach( (elem) => {
		let command = () => {
			try {
				elem.command();
			}
			catch(e) {
				console.error(`[${elem.label}]: ${e}`);
				let message = (e instanceof Error ? e.message : e.toString());
				vscode.window.showErrorMessage(message);
			}
		};

		let disposable = vscode.commands.registerCommand(`extension.${elem.label}`, command);
		context.subscriptions.push(disposable);
	});

	textCommands.forEach( (elem) => {
		let disposable = vscode.commands.registerTextEditorCommand(`extension.${elem.label}`, elem.command);
		context.subscriptions.push(disposable);
	});


	// register a content provider for the config document

	const myProvider = new class implements vscode.TextDocumentContentProvider {

		// emitter and its event
		onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
		onDidChange = this.onDidChangeEmitter.event;

		provideTextDocumentContent(uri: vscode.Uri): string {
			return uri.query;
		}
	};

	context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(zmkDocumentScheme, myProvider));

	vscode.workspace.onDidChangeConfiguration(() => updateCurrentEnvironment() );
	updateCurrentEnvironment();

	// vscode.workspace.onDidOpenTextDocument( (e) => checkCopyrightHeader(e) );
}

// this method is called when your extension is deactivated
export function deactivate() {}
