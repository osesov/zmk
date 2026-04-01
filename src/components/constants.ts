export namespace zmkCommand
{
    export const showOutput = 'zmk.showOutput';
    export const setConfig = 'zmk.setConfig';
    export const setTarget = 'zmk.setTarget';
    export const zmkRefreshConfigTree = "zmk.refreshConfigTree";
    export const zmkSetDefaultConfig = "zmk.setDefaultConfig";
    export const zmkOpenConfig = "zmk.openConfig";

    export const zmkRefreshTargetTree = "zmk.refreshTargetTree";
    export const zmkBuildTarget = "zmk.buildTarget";
    export const zmkSetDefaultTarget = "zmk.setDefaultTarget";
    export const zmkResetTarget = "zmk.resetTarget";
    export const zmkTargetSelected = "zmk.targetSelected";

    export const toggleIncludeTreeView = "zmk.toggleIncludeTreeView";
    export const toggleIncludeListView = "zmk.toggleIncludeListView";

    export const selectValhallaProject = "zmk.selectValhallaProject";
    export const selectAndBuildTarget = "zmk.selectAndBuildTarget";
    export const selectAndRunTest = "zmk.selectAndRunTest";
    export const revealIncludeInExplorer = "zmk.revealIncludeInExplorer";
    export const revealIncludeInOS = "zmk.revealIncludeInOS";
    export const copyText = "zmk.cppSource.copyText";
    export const copyJson = "zmk.cppSource.copyJson";

    export const reviewApply = "zmk.review.apply";
    export const reviewKeepOriginal = "zmk.review.keepOriginal";
}

export namespace Context
{
    export const includeViewMode = "zmk.includeViewMode";
}

export namespace BuildConstants
{
    export const knownBuildModes = [ 'dev', 'prd', 'tst', 'cqa' ];
}

export namespace build
{
    export const defaultCompilerPath = undefined; // '/usr/bin/g++
    export const defaultCppStandard = "c++17"; // TODO: guess from toolchain and/or use from config
    export const defaultIntelliSenseMode = "linux-gcc-x64"; // TODO: guess from toolchain and/or use from config
}
