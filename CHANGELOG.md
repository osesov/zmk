# Change Log

All notable changes to the "zmk" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 1.3.3

- update dependencies to the latest
- update to use multiple work spaces
- do not report errors when run in non-valhalla environment
- Update config examples

## 1.3.2

- Add appcloud/zebra config examples

## 1.3.1

- Fix error messages

## 1.3

- Implemented copyright header insert/update for C++ files.
  Developer name could be configured with 'zmk.developer' settings.
  Copyright template is configured with 'zmk.copyrightComment' setting.


## 1.2.0

- implemented "zmk.bundleDir" setting
- Update zmkUpdateBundlesInclude to use ${env:zmk.bundleDir} prefix.

## 1.1.0

- Export zmk variables as env:zmk.XXX  for c_cpp_properties.json.
  In particular that allows zmk-generated paths to be used in compileCommands path, like that:

      "compileCommands": "${env:zmk.buildDir}/compile_commands.json"

- Allow to show generated c_cpp_properties.json as virtual doc

## 1.0.6

- command: zmkUpdateBundlesInclude.

  Command allows to update c_cpp_properties.json, replacing/adding bundle include paths.

  Note that only these configurations are updated, which already refer path, starting from "${env:zmk.bundleDir}".

  Config setting "zmk.excludeBundles" can be used to exclude some bundles (these might be your work packages).

## 1.0.5

- introduce zmkGetCurrentFile to build single file only

## 1.0.4

- close configuration quick pick

## 1.0.3

- Show current gnb and ninja targets.
- Config selection shows currently selected item

## [Unreleased]

- Initial release
