import { DebugOwner, IReader, IObservable, observableSignal, derived, ObservablePromise } from "./observableInternal";

export function derivedWithInvalidate<T>(owner: DebugOwner, get: (reader: IReader) => T): IObservable<T> & { invalidate: () => void; } {
    const resetSignal = observableSignal('reset');
    const d = derived(owner, reader => {
        resetSignal.read(reader);
        return get(reader);
    });
    (d as any).reset = () => {
        resetSignal.trigger(undefined);
    };
    return d as any;
}

export function derivedPromise<T>(owner: DebugOwner, fn: (reader: IReader) => Promise<T>): IObservable<T | undefined> & { isLoading: IObservable<boolean> } {
    const d = derived(owner, reader => {
        const promise = fn(reader);
        return new ObservablePromise(promise);
    });
    const target = d.map((v, reader) => v.resolved.read(reader));
    (target as any).isLoading = d.map(v => v.promiseResult === undefined);
    return target as any;
}
