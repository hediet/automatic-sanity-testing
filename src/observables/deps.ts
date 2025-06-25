import { IDisposable, DisposableStore } from '../disposables';

export { IDisposable, DisposableStore };

export function toDisposable(fn: () => void): IDisposable {
	return { dispose: fn };
}

export function markAsDisposed(_disposable: IDisposable): void { }

export function trackDisposable(_disposable: IDisposable): void { }

export function assertFn(_fn: () => {}): void { }

export class CancellationError extends Error {
	constructor() {
		super('Cancelled');
	}
}

export interface CancellationToken {

	/**
	 * A flag signalling is cancellation has been requested.
	 */
	readonly isCancellationRequested: boolean;

	/**
	 * An event which fires when cancellation is requested. This event
	 * only ever fires `once` as cancellation can only happen once. Listeners
	 * that are registered after cancellation will be called (next event loop run),
	 * but also only once.
	 *
	 * @event
	 */
	readonly onCancellationRequested: (listener: (e: any) => any, thisArgs?: any, disposables?: IDisposable[]) => IDisposable;
}

export function onBugIndicatingError(_error?: any) {
	debugger;
}

export class BugIndicatingError extends Error {
	constructor(message?: string) {
		super(message);
		this.name = 'BugIndicatingError';
		onBugIndicatingError();
	}
}