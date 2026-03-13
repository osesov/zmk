export namespace zmkCommand
{
    export const showOutput = 'zmk.showOutput';
    export const setConfig = 'zmk.setConfig';
    export const setTarget = 'zmk.setTarget';
    export const zmkRefreshConfigTree = "zmk.refreshConfigTree";
    export const zmkSetDefaultConfig = "zmk.setDefaultConfig";

    export const zmkRefreshTargetTree = "zmk.refreshTargetTree";
    export const zmkBuildTarget = "zmk.buildTarget";
    export const zmkSetDefaultTarget = "zmk.setDefaultTarget";
    export const zmkResetTarget = "zmk.resetTarget";
    export const zmkTargetSelected = "zmk.targetSelected";

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
