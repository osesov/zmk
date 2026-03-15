type ArgValue = string | boolean | number

export namespace ArgsFile
{
    export const fileName = 'args.gn';
}

export class ArgsMap
{
    private values: Map<string, ArgValue>;

    constructor(entries?: Iterable<readonly [string, ArgValue]>)
    {
        this.values = new Map(entries);
    }

    public get<T>(name: string): T | undefined {
        return this.values.get(name) as T | undefined;
    }
}

export function parseArgs(text: string): ArgsMap
{
    // simplified args.gn parsing, only supports simple key=value pairs, no lists, values are single-line.
    // Format follows `gn/gnb_config_parser.py`

    const result = new Map<string, ArgValue>();

    const re = /^\s*(?<name>[a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(?:(?<string>["]([\\].|[^\\"])*?["])|(?<number>\d+)|(?<boolean>true|false))\s*$/u;

    for (const line of text.split('\n')) {
        const eqIndex = line.indexOf('=');
        if (line.trimStart().startsWith('#') || eqIndex < 1) {
            continue; // skip comments and invalid lines
        }

        const match = re.exec(line);
        if (!match) {
            continue; // skip lines that don't match the regex
        }

        const { name, string, number, boolean: bool } = match.groups!;
        if (string !== undefined) {
            result.set(name, JSON.parse(string));
        } else if (number !== undefined) {
            result.set(name, parseInt(number, 10));
        } else if (bool !== undefined) {
            result.set(name, bool === 'true');
        }
    }

    return new ArgsMap(result);
}
