export interface IAsyncServiceInit<T = void>
{
    ready: Promise<T>
}

export async function awaitReady<T extends IAsyncServiceInit<R>, R>(obj: T): Promise<T>
{
    if ('ready' in obj)
        await obj['ready']

    return obj;
}
