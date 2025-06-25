/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// This is a facade for the observable implementation. Only import from here!

export { observableValueOpts } from './api';
export { autorun, autorunDelta, autorunHandleChanges, autorunOpts, autorunWithStore, autorunWithStoreHandleChanges } from './autorun';
export { asyncTransaction, disposableObservableValue, globalTransaction, observableValue, subtransaction, transaction, TransactionImpl, type IChangeContext, type IChangeTracker, type IObservable, type IObservableWithChange, type IObserver, type IReader, type ISettable, type ISettableObservable, type ITransaction, } from './base';
export { derived, derivedDisposable, derivedHandleChanges, derivedOpts, derivedWithSetter, derivedWithStore } from './derived';
export { ObservableLazy, ObservableLazyPromise, ObservablePromise, PromiseResult, } from './promise';
export { waitForState } from './utilsCancellation';
export { constObservable, debouncedObservableDeprecated, debouncedObservable, derivedConstOnceDefined, derivedObservableWithCache, derivedObservableWithWritableCache, keepObserved, latestChangedValue, mapObservableArrayCached, observableFromEvent, observableFromEventOpts, observableFromPromise, observableSignal, observableSignalFromEvent, recomputeInitiallyAndOnChange, runOnChange, runOnChangeWithStore, signalFromObservable, wasEventTriggeredRecently, type IObservableSignal, } from './utils';
export { type DebugOwner } from './debugName';

import { addLogger, setLogObservableFn } from './logging/logging';
import { ConsoleObservableLogger, logObservableToConsole } from './logging/consoleObservableLogger';
import { DevToolsLogger } from './logging/debugger/devToolsLogger';

setLogObservableFn(logObservableToConsole);

// Remove "//" in the next line to enable logging
const enableLogging = false
	// || Boolean("true") // done "weirdly" so that a lint warning prevents you from pushing this
	;

if (enableLogging) {
	addLogger(new ConsoleObservableLogger());
}

addLogger(DevToolsLogger.getInstance());
