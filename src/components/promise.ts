
export class CompletableFeature<T>
{
    private _promise: Promise<T>;
    private _resolve!: (value: T) => void;
    private _reject!: (reason?: any) => void;

    constructor(public name: string)
    {
        this._promise = new Promise<T>((resolve, reject) => {
            this._resolve = resolve;
            this._reject = reject;
        });
    }

    public complete(value: T): void
    {
        this._resolve(value);
    }

    public fail(reason?: any): void
    {
        this._reject(reason);
    }

    public get promise(): Promise<T>
    {
        return this._promise;
    }
}
