import path from "path";

export interface ParsedTarget
{
    original: string;
    path: string;
    pathParts: string[];
    action: string;
}

export function parseTarget(target: string, withValidation: boolean): ParsedTarget | null
{
    if (!target.startsWith("//")) {
        if (withValidation)
            throw new Error(`Invalid target '${target}': must start with '//'`);
        return null;
    }

    const colon = target.lastIndexOf(":");
    if (colon < 0) {
        if (withValidation)
            throw new Error(`Invalid target '${target}': must contain ':'`);
        return null;
    }

    const rawPath = target.slice(2, colon);
    const action = target.slice(colon + 1);

    if (!action) {
        if (withValidation)
            throw new Error(`Invalid target '${target}': action is empty`);
        return null;
    }

    const pathParts = rawPath
        .split("/")
        .filter(part => part.length > 0);

    return {
        original: target,
        path: rawPath,
        pathParts,
        action,
    };
}

export function getGNPath(path: string, withValidation: boolean): string | null
{
    if (!path.startsWith("//")) {
        if (withValidation)
            throw new Error(`Invalid target '${path}': must start with '//'`);
        return null;
    }

    return path.slice(2);
}

// convert a path to target, e.g. /valhalla/file/path -> //file/path
// if path is outside of the project root, return null
export function fsPathToGNPath(p: string, projectRoot: string, suffix?: string): string | null
{
    const r = path.relative(projectRoot, p);
    if (r.startsWith("..")) {
        return null;
    }

    const normalizedPath = r.replace(/\\/g, "/");
    return `//${normalizedPath}${suffix ?? ""}`;
}


export function splitPathIntoComponents(path: string): string[]
{
    const p = extractPathFromTargetOrPath(path);
    return p.split("/").filter(part => part.length > 0);
}

export function matchPathPrefix(path: string[] | string, prefix: string[] | string): boolean
{
    if (typeof path === "string") {
        path = splitPathIntoComponents(path);
    }

    if (typeof prefix === "string") {
        prefix = splitPathIntoComponents(prefix);
    }

    if (prefix.length > path.length) {
        return false;
    }

    for (let i = 0; i < prefix.length; i++) {
        if (path[i] !== prefix[i]) {
            return false;
        }
    }

    return true;
}

export function extractPathFromTargetOrPath(targetOrPath: string): string
{
    const sep = targetOrPath.indexOf(":");
    const p = sep < 0 ? targetOrPath : targetOrPath.slice(0, sep);
    return p;
}

export function extractPathComponentsFromTargetOrPath(targetOrPath: string): string[]
{
    const p = extractPathFromTargetOrPath(targetOrPath);
    return splitPathIntoComponents(p);
}
