import { ISettableObservable, observableValue } from "../observables/observableInternal";

export interface Steps {
    steps: IStep<unknown, unknown>[];
}

export interface IStep<A = unknown, B = A> {
    /**
     * Values that are also considered when comparing new steps with olds.
     */
    uses?: unknown;

    /**
     * Runs this step.
     */
    run: (args: A, context: StepContext) => Promise<B>;

    view: ISettableObservable<unknown>;

    name: string | undefined;

    subSteps?: IStep<unknown, unknown>[];
}

export interface StepContext {
    /**
     * Registers `rewindFn` to be run when the step is rewinded.
     */
    onRewind(rewindFn: () => Promise<any>): void;

    reportSideEffect(): void;

    onReset(resetFn: () => Promise<any>): void;
}

export function composedStep<T1>(): <T2 = T1, T3 = T2, T4 = T3, T5 = T4, T6 = T5, T7 = T6, T8 = T7, T9 = T8>(
    step1?: IStep<T1, T2>,
    step2?: IStep<T2, T3>,
    step3?: IStep<T3, T4>,
    step4?: IStep<T4, T5>,
    step5?: IStep<T5, T6>,
    step6?: IStep<T6, T7>,
    step7?: IStep<T7, T8>,
    step8?: IStep<T8, T9>,
    step9?: IStep<T9, unknown>
) => IStep<T1, T9> {
    return (...steps) => {
        return {
            subSteps: steps.filter(s => s != undefined) as IStep[],
            name: undefined!,
            run: null!,
            view: null!,
        };
    };
}

/**
 * Describes a sequence of steps.
 * Each step can use the result of the previous step.
 */
export function steps<T1, T2, T3, T4, T5, T6, T7, T8, T9>(
    step0: IStep<{}, T1>,
    step1?: IStep<T1, T2>,
    step2?: IStep<T2, T3>,
    step3?: IStep<T3, T4>,
    step4?: IStep<T4, T5>,
    step5?: IStep<T5, T6>,
    step6?: IStep<T6, T7>,
    step7?: IStep<T7, T8>,
    step8?: IStep<T8, T9>,
    step9?: IStep<T9, unknown>
): Steps {
    return {
        steps: [
            step0,
            step1,
            step2,
            step3,
            step4,
            step5,
            step6,
            step7,
            step8,
            step9,
        ].filter(s => s != undefined)
            .flatMap(s => s.subSteps ? s.subSteps : [s]) as IStep[],
    };
}

export function step<T, TResult>(options: IStepOptions, run: (args: T, context: StepContext) => Promise<void>): IStep<T, T>;
export function step<T, TResult>(options: IStepOptions, run: (args: T, context: StepContext) => Promise<TResult>): IStep<T, TResult>;
export function step<T, TResult>(run: (args: T, context: StepContext) => Promise<void>): IStep<T, T>;
export function step<T, TResult>(run: (args: T, context: StepContext) => Promise<TResult>): IStep<T, TResult>;
export function step<T, TResult>(
    optionsOrRun: IStepOptions | ((args: T, context: StepContext) => Promise<TResult>),
    run?: (args: T, context: StepContext) => Promise<TResult>
): IStep<T, TResult> {
    const view = createView_$show2FramesUp();
    const actualRun: any = typeof optionsOrRun === 'function' ? optionsOrRun : run!;
    const options = typeof optionsOrRun === 'object' ? optionsOrRun : {};
    return {
        name: options.name,
        run: actualRun,
        view
    };
}

export interface IStepOptions {
    /**
     * Name of the step.
     */
    name?: string;
}

function createView_$show2FramesUp() {
    return observableValue('view', undefined);
}