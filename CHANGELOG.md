# Change Log

All notable changes to the "zmk" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## 1.0.6
- command: zmkUpdateBundlesInclude. Command allows to update c_cpp_properties.json, replacing     adding bundles include paths.
  Note that only these configurations are updated, which already refer path, starting from
  "${command:extension.zmkGetBuildDir}".
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
