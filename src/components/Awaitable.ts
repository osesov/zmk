import * as vscode from 'vscode';

export class Awaitable<T>
{
    public event: vscode.Event<T>;
    public value: T | null = null;

    constructor(event: vscode.Event<T>)
    {
        this.event = event;
    }
}

export function awaitable<T>() : [Awaitable<T>, (value: T) => void]
{
    const _eventEmitter = new vscode.EventEmitter<T>();
    return [
        new Awaitable(_eventEmitter.event),
        (value: T) => _eventEmitter.fire(value)
    ];
}
