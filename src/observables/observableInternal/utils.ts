/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { autorun, autorunHandleChanges, autorunOpts, autorunWithStoreHandleChanges } from './autorun';
import { BaseObservable, ConvenientObservable, IObservable, IObservableWithChange, IObserver, IReader, ITransaction, _setKeepObserved, _setRecomputeInitiallyAndOnChange, observableValue, subtransaction, transaction } from './base';
import { DebugNameData, DebugOwner, IDebugNameData, getDebugName, } from './debugName';
import { BugIndicatingError, DisposableStore, EqualityComparer, IDisposable, strictEquals, toDisposable } from './commonFacade/deps';
import { derived, derivedOpts } from './derived';
import { getLogger } from './logging/logging';

/**
 * Represents an efficient observable whose value never changes.
 */
export function constObservable<T>(value: T): IObservable<T> {
	return new ConstObservable(value);
}

class ConstObservable<T> extends ConvenientObservable<T, void> {
	constructor(private readonly value: T) {
		super();
	}

	public override get debugName(): string {
		return this.toString();
	}

	public get(): T {
		return this.value;
	}
	public addObserver(_observer: IObserver): void {
		// NO OP
	}
	public removeObserver(_observer: IObserver): void {
		// NO OP
	}

	override log(): IObservableWithChange<T, void> {
		return this;
	}

	override toString(): string {
		return `Const: ${this.value}`;
	}
}


export function observableFromPromise<T>(promise: Promise<T>): IObservable<{ value?: T }> {
	const observable = observableValue<{ value?: T }>('promiseValue', {});
	promise.then((value) => {
		observable.set({ value }, undefined);
	});
	return observable;
}

type Event<TArgs> = (callback: (args: TArgs) => void) => IDisposable;

export function observableFromEvent<T, TArgs = unknown>(
	owner: DebugOwner,
	event: Event<TArgs>,
	getValue: (args: TArgs | undefined) => T,
): IObservable<T>;
export function observableFromEvent<T, TArgs = unknown>(
	event: Event<TArgs>,
	getValue: (args: TArgs | undefined) => T,
): IObservable<T>;
export function observableFromEvent(...args:
	[owner: DebugOwner, event: Event<any>, getValue: (args: any | undefined) => any]
	| [event: Event<any>, getValue: (args: any | undefined) => any]
): IObservable<any> {
	let owner;
	let event;
	let getValue;
	if (args.length === 3) {
		[owner, event, getValue] = args;
	} else {
		[event, getValue] = args;
	}
	return new FromEventObservable(
		new DebugNameData(owner, undefined, getValue),
		event,
		getValue,
		() => FromEventObservable.globalTransaction,
		strictEquals
	);
}

export function observableFromEventOpts<T, TArgs = unknown>(
	options: IDebugNameData & {
		equalsFn?: EqualityComparer<T>;
	},
	event: Event<TArgs>,
	getValue: (args: TArgs | undefined) => T,
): IObservable<T> {
	return new FromEventObservable(
		new DebugNameData(options.owner, options.debugName, options.debugReferenceFn ?? getValue),
		event,
		getValue, () => FromEventObservable.globalTransaction, options.equalsFn ?? strictEquals
	);
}

export class FromEventObservable<TArgs, T> extends BaseObservable<T> {
	public static globalTransaction: ITransaction | undefined;

	private _value: T | undefined;
	private _hasValue = false;
	private _subscription: IDisposable | undefined;

	constructor(
		private readonly _debugNameData: DebugNameData,
		private readonly event: Event<TArgs>,
		public readonly _getValue: (args: TArgs | undefined) => T,
		private readonly _getTransaction: () => ITransaction | undefined,
		private readonly _equalityComparator: EqualityComparer<T>
	) {
		super();
	}

	private getDebugName(): string | undefined {
		return this._debugNameData.getDebugName(this);
	}

	public get debugName(): string {
		const name = this.getDebugName();
		return 'From Event' + (name ? `: ${name}` : '');
	}

	protected override onFirstObserverAdded(): void {
		this._subscription = this.event(this.handleEvent);
	}

	private readonly handleEvent = (args: TArgs | undefined) => {
		const newValue = this._getValue(args);
		const oldValue = this._value;

		const didChange = !this._hasValue || !(this._equalityComparator(oldValue!, newValue));
		let didRunTransaction = false;

		if (didChange) {
			this._value = newValue;

			if (this._hasValue) {
				didRunTransaction = true;
				subtransaction(
					this._getTransaction(),
					(tx) => {
						getLogger()?.handleObservableUpdated(this, { oldValue, newValue, change: undefined, didChange, hadValue: this._hasValue });

						for (const o of this._observers) {
							tx.updateObserver(o, this);
							o.handleChange(this, undefined);
						}
					},
					() => {
						const name = this.getDebugName();
						return 'Event fired' + (name ? `: ${name}` : '');
					}
				);
			}
			this._hasValue = true;
		}

		if (!didRunTransaction) {
			getLogger()?.handleObservableUpdated(this, { oldValue, newValue, change: undefined, didChange, hadValue: this._hasValue });
		}
	};

	protected override onLastObserverRemoved(): void {
		this._subscription!.dispose();
		this._subscription = undefined;
		this._hasValue = false;
		this._value = undefined;
	}

	public get(): T {
		if (this._subscription) {
			if (!this._hasValue) {
				this.handleEvent(undefined);
			}
			return this._value!;
		} else {
			// no cache, as there are no subscribers to keep it updated
			const value = this._getValue(undefined);
			return value;
		}
	}

	public debugSetValue(value: unknown) {
		this._value = value as any;
	}
}

export namespace observableFromEvent {
	export const Observer = FromEventObservable;

	export function batchEventsGlobally(tx: ITransaction, fn: () => void): void {
		let didSet = false;
		if (FromEventObservable.globalTransaction === undefined) {
			FromEventObservable.globalTransaction = tx;
			didSet = true;
		}
		try {
			fn();
		} finally {
			if (didSet) {
				FromEventObservable.globalTransaction = undefined;
			}
		}
	}
}

export function observableSignalFromEvent(
	owner: DebugOwner | string,
	event: Event<any>
): IObservable<void> {
	return new FromEventObservableSignal(typeof owner === 'string' ? owner : new DebugNameData(owner, undefined, undefined), event);
}

class FromEventObservableSignal extends BaseObservable<void> {
	private subscription: IDisposable | undefined;

	public readonly debugName: string;
	constructor(
		debugNameDataOrName: DebugNameData | string,
		private readonly event: Event<any>,
	) {
		super();
		this.debugName = typeof debugNameDataOrName === 'string'
			? debugNameDataOrName
			: debugNameDataOrName.getDebugName(this) ?? 'Observable Signal From Event';
	}

	protected override onFirstObserverAdded(): void {
		this.subscription = this.event(this.handleEvent);
	}

	private readonly handleEvent = () => {
		transaction(
			(tx) => {
				for (const o of this._observers) {
					tx.updateObserver(o, this);
					o.handleChange(this, undefined);
				}
			},
			() => this.debugName
		);
	};

	protected override onLastObserverRemoved(): void {
		this.subscription!.dispose();
		this.subscription = undefined;
	}

	public override get(): void {
		// NO OP
	}
}

/**
 * Creates a signal that can be triggered to invalidate observers.
 * Signals don't have a value - when they are triggered they indicate a change.
 * However, signals can carry a delta that is passed to observers.
 */
export function observableSignal<TDelta = void>(debugName: string): IObservableSignal<TDelta>;
export function observableSignal<TDelta = void>(owner: object): IObservableSignal<TDelta>;
export function observableSignal<TDelta = void>(debugNameOrOwner: string | object): IObservableSignal<TDelta> {
	if (typeof debugNameOrOwner === 'string') {
		return new ObservableSignal<TDelta>(debugNameOrOwner);
	} else {
		return new ObservableSignal<TDelta>(undefined, debugNameOrOwner);
	}
}

export interface IObservableSignal<TChange> extends IObservableWithChange<void, TChange> {
	trigger(tx: ITransaction | undefined, change: TChange): void;
}

class ObservableSignal<TChange> extends BaseObservable<void, TChange> implements IObservableSignal<TChange> {
	public get debugName() {
		return new DebugNameData(this._owner, this._debugName, undefined).getDebugName(this) ?? 'Observable Signal';
	}

	public override toString(): string {
		return this.debugName;
	}

	constructor(
		private readonly _debugName: string | undefined,
		private readonly _owner?: object,
	) {
		super();
	}

	public trigger(tx: ITransaction | undefined, change: TChange): void {
		if (!tx) {
			transaction(tx => {
				this.trigger(tx, change);
			}, () => `Trigger signal ${this.debugName}`);
			return;
		}

		for (const o of this._observers) {
			tx.updateObserver(o, this);
			o.handleChange(this, change);
		}
	}

	public override get(): void {
		// NO OP
	}
}

export function signalFromObservable<T>(owner: DebugOwner | undefined, observable: IObservable<T>): IObservable<void> {
	return derivedOpts({
		owner,
		equalsFn: () => false,
	}, reader => {
		observable.read(reader);
	});
}

/**
 * @deprecated Use `debouncedObservable` instead.
 */
export function debouncedObservableDeprecated<T>(observable: IObservable<T>, debounceMs: number, disposableStore: DisposableStore): IObservable<T | undefined> {
	const debouncedObservable = observableValue<T | undefined>('debounced', undefined);

	let timeout: any = undefined;

	disposableStore.add(autorun(reader => {
		/** @description debounce */
		const value = observable.read(reader);

		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => {
			transaction(tx => {
				debouncedObservable.set(value, tx);
			});
		}, debounceMs);

	}));

	return debouncedObservable;
}

/**
 * Creates an observable that debounces the input observable.
 */
export function debouncedObservable<T>(observable: IObservable<T>, debounceMs: number): IObservable<T> & { isUpToDate: IObservable<boolean> } {
	let hasValue = false;
	let lastValue: T | undefined;

	let timeout: any = undefined;

	const isUpToDate = observableValue('isUpToDate', true);

	const res = observableFromEvent<T, void>(cb => {
		const d = autorun(reader => {
			const value = observable.read(reader);

			if (!hasValue) {
				hasValue = true;
				lastValue = value;
			} else {
				if (timeout) {
					clearTimeout(timeout);
				}
				isUpToDate.set(false, undefined);
				timeout = setTimeout(() => {
					lastValue = value;
					transaction(tx => {
						isUpToDate.set(true, tx);
						cb();
					});
				}, debounceMs);
			}
		});
		return {
			dispose() {
				d.dispose();
				hasValue = false;
				lastValue = undefined;
			},
		};
	}, () => {
		if (hasValue) {
			return lastValue!;
		} else {
			return observable.get();
		}
	});

	const r = res.map((val, reader) => {
		isUpToDate.read(reader);
		return val;
	});

	(r as any).isUpToDate = isUpToDate;
	return r as any;
}

export function wasEventTriggeredRecently(event: Event<any>, timeoutMs: number, disposableStore: DisposableStore): IObservable<boolean> {
	const observable = observableValue('triggeredRecently', false);

	let timeout: any = undefined;

	disposableStore.add(event(() => {
		observable.set(true, undefined);

		if (timeout) {
			clearTimeout(timeout);
		}
		timeout = setTimeout(() => {
			observable.set(false, undefined);
		}, timeoutMs);
	}));

	return observable;
}

/**
 * This makes sure the observable is being observed and keeps its cache alive.
 */
export function keepObserved<T>(observable: IObservable<T>): IDisposable {
	const o = new KeepAliveObserver(false, undefined);
	observable.addObserver(o);
	return toDisposable(() => {
		observable.removeObserver(o);
	});
}

_setKeepObserved(keepObserved);

/**
 * This converts the given observable into an autorun.
 */
export function recomputeInitiallyAndOnChange<T>(observable: IObservable<T>, handleValue?: (value: T) => void): IDisposable {
	const o = new KeepAliveObserver(true, handleValue);
	observable.addObserver(o);
	try {
		o.beginUpdate(observable);
	} finally {
		o.endUpdate(observable);
	}

	return toDisposable(() => {
		observable.removeObserver(o);
	});
}

_setRecomputeInitiallyAndOnChange(recomputeInitiallyAndOnChange);

export class KeepAliveObserver implements IObserver {
	private _counter = 0;

	constructor(
		private readonly _forceRecompute: boolean,
		private readonly _handleValue: ((value: any) => void) | undefined,
	) {
	}

	beginUpdate<T>(_observable: IObservable<T>): void {
		this._counter++;
	}

	endUpdate<T>(observable: IObservable<T>): void {
		if (this._counter === 1 && this._forceRecompute) {
			if (this._handleValue) {
				this._handleValue(observable.get());
			} else {
				observable.reportChanges();
			}
		}
		this._counter--;
	}

	handlePossibleChange<T>(_observable: IObservable<T>): void {
		// NO OP
	}

	handleChange<T, TChange>(_observable: IObservableWithChange<T, TChange>, _change: TChange): void {
		// NO OP
	}
}

export function derivedObservableWithCache<T>(owner: DebugOwner, computeFn: (reader: IReader, lastValue: T | undefined) => T): IObservable<T> {
	let lastValue: T | undefined = undefined;
	const observable = derivedOpts({ owner, debugReferenceFn: computeFn }, reader => {
		lastValue = computeFn(reader, lastValue);
		return lastValue;
	});
	return observable;
}

export function derivedObservableWithWritableCache<T>(owner: object, computeFn: (reader: IReader, lastValue: T | undefined) => T): IObservable<T>
	& { clearCache(transaction: ITransaction): void; setCache(newValue: T | undefined, tx: ITransaction | undefined): void } {
	let lastValue: T | undefined = undefined;
	const onChange = observableSignal('derivedObservableWithWritableCache');
	const observable = derived(owner, reader => {
		onChange.read(reader);
		lastValue = computeFn(reader, lastValue);
		return lastValue;
	});
	return Object.assign(observable, {
		clearCache: (tx: ITransaction) => {
			lastValue = undefined;
			onChange.trigger(tx);
		},
		setCache: (newValue: T | undefined, tx: ITransaction | undefined) => {
			lastValue = newValue;
			onChange.trigger(tx);
		}
	});
}

/**
 * When the items array changes, referential equal items are not mapped again.
 */
export function mapObservableArrayCached<TIn, TOut, TKey = TIn>(
	owner: DebugOwner,
	items: IObservable<readonly TIn[]>,
	map: (input: TIn, store: DisposableStore) => TOut,
	keySelector?: (input: TIn) => TKey,
	update?: (input: TIn, output: TOut) => void,
): IObservable<readonly TOut[]> {
	let m = new ArrayMap(map, keySelector, update);
	const self = derivedOpts({
		debugReferenceFn: map,
		owner,
		onLastObserverRemoved: () => {
			m.dispose();
			m = new ArrayMap(map);
		}
	}, (reader) => {
		m.setItems(items.read(reader));
		return m.getItems();
	});
	return self;
}

class ArrayMap<TIn, TOut, TKey> implements IDisposable {
	private readonly _cache = new Map<TKey, { out: TOut; store: DisposableStore; update?: (arg: TIn) => void }>();
	private _items: TOut[] = [];
	constructor(
		private readonly _map: (input: TIn, store: DisposableStore) => TOut,
		private readonly _keySelector?: (input: TIn) => TKey,
		private readonly _update?: (input: TIn, output: TOut) => void,
	) {
	}

	public dispose(): void {
		this._cache.forEach(entry => entry.store.dispose());
		this._cache.clear();
	}

	public setItems(items: readonly TIn[]): void {
		const newItems: TOut[] = [];
		const itemsToRemove = new Set(this._cache.keys());

		for (const item of items) {
			const key = this._keySelector ? this._keySelector(item) : item as unknown as TKey;

			let entry = this._cache.get(key);
			if (!entry) {
				const store = new DisposableStore();
				const out = this._map(item, store);
				entry = { out, store, update: (item) => this._update?.(item, out) };
				this._cache.set(key, entry);
			} else {
				if (entry.update) {
					entry.update(item);
				}
				itemsToRemove.delete(key);
			}
			newItems.push(entry.out);
		}

		for (const item of itemsToRemove) {
			const entry = this._cache.get(item)!;
			entry.store.dispose();
			this._cache.delete(item);
		}

		this._items = newItems;
	}

	public getItems(): TOut[] {
		return this._items;
	}
}

/**
 * Creates an observable that has the latest changed value of the given observables.
 * Initially (and when not observed), it has the value of the last observable.
 * When observed and any of the observables change, it has the value of the last changed observable.
 * If multiple observables change in the same transaction, the last observable wins.
*/
export function latestChangedValue<T extends IObservable<any>[]>(owner: DebugOwner, observables: T): IObservable<ReturnType<T[number]['get']>> {
	if (observables.length === 0) {
		throw new BugIndicatingError();
	}

	let hasLastChangedValue = false;
	let lastChangedValue: any = undefined;

	const result = observableFromEvent<any, void>(owner, cb => {
		const store = new DisposableStore();
		for (const o of observables) {
			store.add(autorunOpts({ debugName: () => getDebugName(result, new DebugNameData(owner, undefined, undefined)) + '.updateLastChangedValue' }, reader => {
				hasLastChangedValue = true;
				lastChangedValue = o.read(reader);
				cb();
			}));
		}
		store.add({
			dispose() {
				hasLastChangedValue = false;
				lastChangedValue = undefined;
			},
		});
		return store;
	}, () => {
		if (hasLastChangedValue) {
			return lastChangedValue;
		} else {
			return observables[observables.length - 1].get();
		}
	});
	return result;
}

/**
 * Works like a derived.
 * However, if the value is not undefined, it is cached and will not be recomputed anymore.
 * In that case, the derived will unsubscribe from its dependencies.
*/
export function derivedConstOnceDefined<T>(owner: DebugOwner, fn: (reader: IReader) => T): IObservable<T | undefined> {
	return derivedObservableWithCache<T | undefined>(owner, (reader, lastValue) => lastValue ?? fn(reader));
}

type RemoveUndefined<T> = T extends undefined ? never : T;

export function runOnChange<T, TChange>(observable: IObservableWithChange<T, TChange>, cb: (value: T, previousValue: undefined | T, deltas: RemoveUndefined<TChange>[]) => void): IDisposable {
	let _previousValue: T | undefined;
	return autorunWithStoreHandleChanges({
		createEmptyChangeSummary: () => ({ deltas: [] as RemoveUndefined<TChange>[], didChange: false }),
		handleChange: (context, changeSummary) => {
			if (context.didChange(observable)) {
				const e = context.change;
				if (e !== undefined) {
					changeSummary.deltas.push(e as RemoveUndefined<TChange>);
				}
				changeSummary.didChange = true;
			}
			return true;
		},
	}, (reader, changeSummary) => {
		const value = observable.read(reader);
		const previousValue = _previousValue;
		if (changeSummary.didChange) {
			_previousValue = value;
			cb(value, previousValue, changeSummary.deltas);
		}
	});
}

export function runOnChangeWithStore<T, TChange>(observable: IObservableWithChange<T, TChange>, cb: (value: T, previousValue: undefined | T, deltas: RemoveUndefined<TChange>[], store: DisposableStore) => void): IDisposable {
	const store = new DisposableStore();
	const disposable = runOnChange(observable, (value, previousValue: undefined | T, deltas) => {
		store.clear();
		cb(value, previousValue, deltas, store);
	});
	return {
		dispose() {
			disposable.dispose();
			store.dispose();
		}
	};
}

type ObservableResult<T> = T extends IObservableWithChange<infer U, any> ? U : never;

type ObservableArrayToChangesData<T extends Record<string, IObservableWithChange<any, any>>> = {
	[Key in keyof T]: {
		value: ObservableResult<T[Key]>;
		changes: T[Key]['TChange'][];
		/**
		 * The value of the observable before the changes. `undefined` if
		 */
		previous: ObservableResult<T[Key]> | undefined;
	}
};

export function autorunWithChanges<T extends Record<string, IObservableWithChange<any, any>>>(owner: object, observables: T, handler: (data: ObservableArrayToChangesData<T>) => void): IDisposable {
	const observableToKey = new Map(Object.entries(observables).map(([key, value]) => [value, key] as const));

	const previousValues = new Map(Object.keys(observables).map(key => [key, undefined]));

	return autorunHandleChanges({
		owner,
		createEmptyChangeSummary: () => ({}) as ObservableArrayToChangesData<T>,
		handleChange: (ctx, changeSummary) => {
			const key = observableToKey.get(ctx.changedObservable)!;

			if (changeSummary[key] === undefined) {
				(changeSummary as any)[key] = { value: undefined!, changes: [] };
			}
			changeSummary[key].changes.push(ctx.change);
			return true;
		}
	}, (reader, data) => {
		for (const [key, value] of Object.entries(observables)) {
			const v = value.read(reader);

			if (data[key] === undefined) {
				(data as any)[key] = { value: v, changes: [], previous: previousValues.get(key) };
			}
			data[key].value = v;
			data[key].previous = previousValues.get(key) === undefined ? undefined : previousValues.get(key);
			previousValues.set(key, v);
		}
		handler(data);
	});
}
