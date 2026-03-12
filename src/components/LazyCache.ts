// exclude 'undefined' from the type, as it is used to indicate that the value has not been evaluated yet

export class LazyCache<T extends {} | null>
{
    private value: T | null | undefined = undefined;
    constructor(private evalValue: () => T )
    {
    }

    get(): T
    {
        if (this.value === undefined) {
            this.value = null;
            try {
                this.value = this.evalValue();
            } catch {
                this.value = null;
            }
        }
        return this.value as T;
    }

    reset()
    {
        this.value = undefined;
    }

}
