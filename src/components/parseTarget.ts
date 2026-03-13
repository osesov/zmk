export interface ParsedTarget
{
    original: string;
    path: string;
    pathParts: string[];
    action: string;
}

export function parseTarget(target: string): ParsedTarget {
    if (!target.startsWith("//")) {
        throw new Error(`Invalid target '${target}': must start with '//'`);
    }

    const colon = target.lastIndexOf(":");
    if (colon < 0) {
        throw new Error(`Invalid target '${target}': must contain ':'`);
    }

    const rawPath = target.slice(2, colon);
    const action = target.slice(colon + 1);

    if (!action) {
        throw new Error(`Invalid target '${target}': action is empty`);
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
