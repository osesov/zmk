export namespace zmkCommand
{
    export const showOutput = 'zmk.showOutput';
    export const setConfig = 'zmk.setConfig';
    export const setTarget = 'zmk.setTarget';
    export const zmkRefreshConfigTree = "zmk.refreshConfigTree";
    export const zmkSetDefaultConfig = "zmk.selectConfig";

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
