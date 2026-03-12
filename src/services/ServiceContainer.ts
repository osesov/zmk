export type ServiceMap = Record<string, unknown>;

export type ServiceFactory<TServices extends ServiceMap, T> = (
    container: ServiceContainer<TServices>
) => T;

export class ServiceContainer<TServices extends ServiceMap>
{
    private readonly instances = new Map<keyof TServices, TServices[keyof TServices]>();
    private readonly factories = new Map<
        keyof TServices,
        ServiceFactory<TServices, TServices[keyof TServices]>
    >();

    registerInstance<K extends keyof TServices>(
        key: K,
        value: TServices[K]
    ): this {
        this.instances.set(key, value);
        return this;
    }

    registerFactory<K extends keyof TServices>(
        key: K,
        factory: ServiceFactory<TServices, TServices[K]>
    ): this {
        this.factories.set(
            key,
            factory as ServiceFactory<TServices, TServices[keyof TServices]>
        );
        return this;
    }

    has<K extends keyof TServices>(key: K): boolean {
        return this.instances.has(key) || this.factories.has(key);
    }

    get<K extends keyof TServices>(key: K): TServices[K] {
        if (this.instances.has(key)) {
            return this.instances.get(key) as TServices[K];
        }

        const factory = this.factories.get(key);
        if (!factory) {
            throw new Error(`Service not registered: ${String(key)}`);
        }

        const instance = factory(this) as TServices[K];
        this.instances.set(key, instance);
        return instance;
    }
}
