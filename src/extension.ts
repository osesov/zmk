import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TextEditor, TextEditorEdit } from 'vscode';
import { ValhallaCppToolsProviderService } from './services/impl/ValhallaCppToolsProviderService';
import { ServiceContainer } from './services/ServiceContainer';
import { VirtualDocumentProvider } from './services/impl/VirtualDocumentProviderService';
import { BuilderService } from './services/impl/BuilderService';
import { SettingsService } from './services/impl/SettingsService';
import { StatusService } from './services/impl/StatusService';
import { ValhallaTaskProvider } from './components/tasks';
import { BuildStatusService } from './services/impl/BuildStatusService';
import { UIService } from './services/impl/UIService';
import { ConfigTreeProvider } from './services/impl/ConfigTreeDataProvider';
import { TargetTreeProvider } from './services/impl/TargetTreeProvider';
import { ProjectInfoService } from './services/impl/ProjectInfoService';
import { SourceFileConfigurationItemTreeProvider } from './services/impl/SourceFileConfigurationItemTreeProvider';
import { Completion } from './components/promise';
import { ArgsFileService } from './services/impl/ArgsFileService';
import { AppServiceContainer } from './services/AppServices';
import { ArgsTreeProvider } from './services/impl/ArgsTreeProvider';
import { CompileCommandsService } from './services/impl/CompileCommandsService';
import { ReviewService } from './services/impl/ReviewService';
import { getBuildDirAndCreate, getCurrentFile, getNfsDir, getNinjaTarget, getOrDefault, getRootDir, getTargetConfig, updateCurrentEnvironment } from './components/oldies';
import { zmkUpdateBundlesInclude } from './components/CCxxPropertiesFile';
import { awaitReady } from './services/IAsyncServiceInit';
import { SourceFileConfigurationService } from './services/impl/SourceFileConfigurationService';
import { FileDecorationProvider } from './services/impl/FileDecorationProvider';
import { TestController } from './services/impl/TestController';
import { UpdateService } from './services/impl/UpdateService';
import { LMBuilder } from './services/impl/LMBuilder';
import { FileService } from './services/impl/FileService';

const zmkDocumentScheme = 'zmkdoc';

type Comment = { begin:string, end:string, prefix: string };

function comment(b: string, i: string, e: string) : Comment
{
	const c: Comment = {
		begin: b, prefix: i, end: e
	};

	return c;
}
const languages : { [key:string]: Comment } = {
	'cpp': comment("/*", " *", "*/"),
};

function formatDate(date: Date) {
    let month = '' + (date.getMonth() + 1);
    let day = '' + date.getDate();
    const year = date.getFullYear();

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

	const languageId = editor.document.languageId;
	if (languageId !== "cpp") {
		vscode.window.showWarningMessage("Language is not supported");
		return;
	}

	const comment = languages[languageId];
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

	const commentText = template
		.replace("@DEVELOPER@", developer)
		.replace("@YEAR@", currentYear)
		.replace("@DATE@", currentDate)
		;

	let lines = "/*\n"
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
		let position = findInsertionPoint(document);
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

let askCopyrightHeader = true;

function checkCopyrightHeader(document: vscode.TextDocument)
{
	if (!askCopyrightHeader) {
		return;
	}

	const languageId = document.languageId;

	if (languageId !== "cpp") {
		return;
	}

	if (matchCopyrightComment(document) !== null) {
		return;
	}

	const okButton = "Ok";
	const doNotAskButton = "Do not ask"
	vscode.window.showWarningMessage("Document has no Copyright header, insert?", okButton, doNotAskButton)
		.then( action => {
			if (action === okButton) {
				vscode.commands.executeCommand("zmk.updateCopyright");
			}
			else if (action === doNotAskButton) {
				askCopyrightHeader = false;
			}
		});
}

async function getDependency(services: AppServiceContainer): Promise<string>
{
	const uri = vscode.window.activeTextEditor?.document.uri;
	if (!uri) {
		return "";
	}

	const sourceFileInfo = services.get('sourceFileInfo');
	const targets = sourceFileInfo.getDependenciesForSourceFile(uri);

	if (!targets || targets.length === 0) {
		return "";
	}

	if (targets.length === 1) {
		return targets[0];
	}

	return vscode.window.showQuickPick(targets, {placeHolder: "Multiple targets for current file, select one"})
		.then( target => {
			if (target) {
				vscode.window.showInformationMessage(`Selected target: ${target}`);
				return target;
			}
			else {
				return "";
			}
		});
}

export async function activate(context: vscode.ExtensionContext) {
	const services: AppServiceContainer = new ServiceContainer();
	const buildOutputChannel = vscode.window.createOutputChannel('Valhalla Build');
	const logOutputChannel = vscode.window.createOutputChannel('Valhalla', {log: true});

	const buildComplete = new vscode.EventEmitter<boolean>();
	const initialBuild = new Completion<boolean>('initialBuildStatus');

	services
		.registerInstance('context', context)
		.registerInstance('buildOutputChannel', buildOutputChannel)
		.registerInstance('logOutputChannel', logOutputChannel)
		.registerInstance('buildComplete', buildComplete.event)
		.registerInstance('initialBuild', initialBuild.promise)
		.registerInstance('fs', new FileService())
		.registerInstance('settings', await awaitReady(new SettingsService(services)))
		.registerInstance('argsFile', new ArgsFileService(services))
		.registerInstance('projectInfo', new ProjectInfoService(services))
		.registerInstance('compileCommands', new CompileCommandsService(services))
		.registerInstance('virtualDocumentProvider', new VirtualDocumentProvider(services))
		.registerInstance('builder', new BuilderService(services))
		.registerInstance('buildStatus', new BuildStatusService(services, buildComplete, initialBuild))
		.registerInstance('sourceFileInfo', new SourceFileConfigurationService(services))
		.registerInstance('cppToolsProvider', await ValhallaCppToolsProviderService.create(services))
		.registerInstance('tasks', new ValhallaTaskProvider(services))
		.registerInstance('status', new StatusService(services))
		.registerInstance('ui', new UIService(services))
		.registerInstance('configTree', new ConfigTreeProvider(services))
		.registerInstance('targetTree', new TargetTreeProvider(services))
		.registerInstance('sourceFileConfigurationTree', new SourceFileConfigurationItemTreeProvider(services))
		.registerInstance('argsTree', new ArgsTreeProvider(services))
		.registerInstance('review', new ReviewService(services))
		.registerInstance('testController', new TestController(services))
		.registerInstance('update', new UpdateService(services))
		.registerInstance('lmBuilder', new LMBuilder(services))
		// .registerInstance('fileDecorations', new FileDecorationProvider(services))
		;

	const commands = [
		{ label: 'zmk.getTargetConfig', command: getTargetConfig },
		{ label: 'zmk.getNinjaTarget', command: getNinjaTarget },
		{ label: 'zmk.getRootDir', command: getRootDir },
		{ label: 'zmk.getBuildDir', command: getBuildDirAndCreate },
		{ label: 'zmk.getNfsDir', command: getNfsDir },
		{ label: 'zmk.getCurrentFile', command: getCurrentFile },
		{ label: 'zmk.getCurrentFileTarget', command: () => getDependency(services) },
		{ label: 'zmk.updateBundlesInclude', command: () => zmkUpdateBundlesInclude(services) }
	];

	const textCommands = [
		{ label: 'zmk.updateCopyright', command: zmkUpdateCopyright }
	];

	commands.forEach( (elem) => {
		const command = () => {
			try {
				const x = elem.command();
				console.info(`Command [${elem.label}]: -> ${x}`);
				return x;
			}
			catch(e: unknown) {
				console.error(`Command: [${elem.label}]: ${e}`);
				const message = (e instanceof Error ? e.message : String(e));
				vscode.window.showErrorMessage(message);
				throw e;
			}
		};

		const disposable = vscode.commands.registerCommand(elem.label, command);
		context.subscriptions.push(disposable);
	});

	textCommands.forEach( (elem) => {
		const disposable = vscode.commands.registerTextEditorCommand(elem.label, elem.command);
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
