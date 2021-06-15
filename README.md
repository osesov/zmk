# zmk README

This is an extension to support making valhalla builds from VS Code.

## Features

Detects and applies build configuration on run.

## Requirements

Should be run withing valhalla tree

## Extension Settings

This extension contributes the following settings:

* `zmk.target`: build target, to be used in vscode files
* `zmk.config`: build config
* `zmk.rootDir`: root dir of valhalla tree
* `zmk.buildDir`: build dir of valhalla target
* `zmk.bundleDir`: bundle dir

## using dynamic settings
Externsion turned to use dynamically calculated settings using commands:

* `${command:extension.zmkGetTargetConfig}`
* `${command:extension.zmkGetNinjaTarget}`
* `${command:extension.zmkGetRootDir}`
* `${command:extension.zmkGetBuildDir}`
* `${command:extension.zmkGetNfsDir}`

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of extension

**Enjoy!**

----------------------------------------------

# Extra info


## Links

* [VSCode API](https://code.visualstudio.com/api/references/vscode-api)
* [awesome vscode](https://viatsko.github.io/awesome-vscode/)
* [vsce tool](https://vscode-docs.readthedocs.io/en/latest/tools/vscecli/)
* [Publishing Extension](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
* [Output Colorizer](https://marketplace.visualstudio.com/items?itemName=IBM.output-colorizer)

## Working with Markdown

**Note:** You can author your README using Visual Studio Code.  Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux)
* Toggle preview (`Shift+CMD+V` on macOS or `Shift+Ctrl+V` on Windows and Linux)
* Press `Ctrl+Space` (Windows, Linux) or `Cmd+Space` (macOS) to see a list of Markdown snippets

### For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

## Release

* Update version in package.json
* Update CHANGELOG.md
* Build package (`npm run package`)
* Upload package to github
* Tag version on github
