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
