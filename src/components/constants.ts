export namespace zmkCommand
{
    export const showOutput = 'zmk.showOutput';
    export const setConfig = 'zmk.setConfig';
    export const setTarget = 'zmk.setTarget';
    export const zmkRefreshConfigTree = "zmk.refreshConfigTree";
    export const zmkPickConfig = "zmk.pickConfig";
}

export namespace BuildConstants
{
    export const knownBuildModes = [ 'dev', 'prd', 'tst', 'cqa' ];
}
