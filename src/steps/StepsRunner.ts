import { Disposable, DisposableStore } from "../disposables";
import { autorun, derived, IReader, observableValue, transaction, waitForState } from "../observables/observableInternal";
import { formatValue } from "./formatValue";
import { IStep, Steps } from "./steps";

const g = globalThis as any as {
    steps: ISteps;
};

interface ISteps {
    stateStr: string;
    stepsData: IStepData[];
}

interface IStepData {
    name: string | undefined;
    result: unknown | undefined;
    state: 'pending' | 'running' | 'done' | 'error' | 'pendingRewind' | 'rewinding' | 'dead';
}

export class StepsRunner extends Disposable {
    private readonly disposables = this._register(new DisposableStore());
    private readonly _stepInstances = observableValue(this, [] as readonly StepInstance[]);

    private _targetStepIdx = observableValue(this, 0);
    private _lastStepIdx = observableValue(this, -1);

    constructor(steps?: Steps) {
        super();

        if (steps) {
            this.update(steps);
            this._process();
        }

        this._stepInstances.recomputeInitiallyAndOnChange(this._store);
        this._targetStepIdx.recomputeInitiallyAndOnChange(this._store);

        this._register(autorun(reader => {
            const steps = this._getSteps(reader);
            g.steps = steps;
        }));
    }

    public async getFinalResult(): Promise<unknown> {
        this._targetStepIdx.set(this._stepInstances.get().length - 1, undefined);
        const data = await waitForState(
            derived(reader => {
                const steps = this._stepInstances.read(reader);
                if (steps.some(s => s.state.read(reader) === 'error')) {
                    return { hasError: true };
                }
                const lastStep = steps.at(-1)!;
                if (lastStep.state.read(reader) !== 'done') {
                    return undefined;
                }
                return {
                    result: lastStep.result.get(),
                }
            }),
            p => p !== undefined,
            state => state?.hasError
        );

        return data.result;
    }

    private _getSteps(reader: IReader): ISteps {
        const steps = this._stepInstances.read(reader).map(s => ({
            name: s.definition.step.name,
            result: s.result.read(reader),
            state: s.state.read(reader)
        }));

        const stateStr = `
# This is the step execution system.

When you modify the source of a step, that step is automatically rerun.
Each step gets the result of the previous step as input and uses it to compute its own result.

These steps are currently present:

${steps.map((s, i) => `
## Step ${i + 1}: ${s.name || 'Unnamed'}
- State: ${s.state}
- Result: ${formatValue(s.result, 200)}
- Result expression: globalThis.steps.stepsData[${i}].result

`).join('\n')}

`;

        return {
            stateStr,
            stepsData: steps
        };
    }

    update(steps: Steps): void {
        this.disposables.clear();


        const curDefs = this._stepInstances.get().map(s => s.definition);
        const newDefs = steps.steps.map(s => new StepDefinition(s));
        const diff = compareSteps(curDefs, newDefs);
        const outdatedInstancesLength = curDefs.length - diff.equalStartCount - diff.equalEndCount;
        const newInstancesLength = newDefs.length - diff.equalStartCount - diff.equalEndCount;


        const newInstancesDefs = newDefs.slice(diff.equalStartCount, diff.equalStartCount + newInstancesLength);
        const newInstances = newInstancesDefs.map(def => new StepInstance(def));

        const curInstances = this._stepInstances.get();
        const oldInstances = curInstances.slice(diff.equalStartCount, diff.equalStartCount + outdatedInstancesLength);

        for (const oldInstance of oldInstances) {
            oldInstance.markAsStale();
            if (oldInstance.state.get() !== 'done') {
                oldInstance.dispose();
            }
        }

        // Can we rewind the step?
        let canRewind = true;

        for (let i = this._lastStepIdx.get(); i >= diff.equalStartCount; i--) {
            const stepInstance = curInstances[i];
            if (stepInstance.hasSideEffect && stepInstance.undoActions.length === 0) {
                canRewind = false;
                break;
            }
        }

        if (canRewind) {
            transaction(tx => {

                for (let i = this._lastStepIdx.get(); i >= diff.equalStartCount; i--) {
                    const stepInstance = curInstances[i];

                    const undoActions = [...stepInstance.undoActions];
                    stepInstance.undoActions.length = 0;

                    this._queue.push(async () => {
                        stepInstance.state.set('rewinding', undefined);
                        for (const undoAction of undoActions) {
                            await undoAction();
                        }
                        if (stepInstance.stale.get()) {
                            stepInstance.state.set('dead', undefined);
                            stepInstance.dispose();
                        } else {
                            stepInstance.state.set('pending', undefined);
                        }
                    });

                    stepInstance.state.set('pendingRewind', tx);
                }
                this._lastStepIdx.set(diff.equalStartCount - 1, tx);
            });

        } else {
            // find last reset action
            let resetIdx = -1;
            for (let i = diff.equalStartCount; i >= 0; i--) {
                const stepInstance = curInstances[i];
                if (stepInstance.resetActions.length > 0) {
                    resetIdx = i;
                    break;
                }
            }

            if (resetIdx === -1) {
                console.warn("No reset action found, cannot reset steps.");
                return;
            }
            const resetStep = curInstances[resetIdx];
            transaction(tx => {
                resetStep.state.set('pendingRewind', undefined);
                for (let i = this._lastStepIdx.get(); i > resetIdx; i--) {
                    const stepInstance = curInstances[i];

                    if (stepInstance.stale.get()) {
                        stepInstance.state.set('dead', undefined);
                        stepInstance.dispose();
                    } else {
                        stepInstance.state.set('pending', undefined);
                    }
                }
                this._lastStepIdx.set(resetIdx - 1, tx);
            });

            const resetActions = [...resetStep.resetActions];
            resetStep.resetActions.length = 0;
            this._queue.push(async () => {
                resetStep.state.set('rewinding', undefined);
                console.log(`Resetting steps from index ${resetIdx} onwards...`);
                for (const resetAction of resetActions) {
                    await resetAction();
                }
                console.log(`Reset actions completed for step ${resetIdx}.`);
                resetStep.state.set('pending', undefined);
            });
        }

        const updatedInstances =
            curInstances.slice(0, diff.equalStartCount)
                .concat(newInstances)
                .concat(curInstances.slice(diff.equalStartCount + outdatedInstancesLength));

        this._stepInstances.set(updatedInstances, undefined);

        this.runAfter(diff.equalStartCount + newInstancesLength - 1);
    }

    private readonly _queue: (() => Promise<void>)[] = [];
    private _isProcessing = false;

    private async _process() {
        if (this._isProcessing) {
            return;
        }
        this._isProcessing = true;

        try {

            while (true) {
                if (this._queue.length > 0) {
                    const fn = this._queue.pop();
                    if (fn) {
                        try {
                            await fn();
                        } catch (e) {
                            console.error("Error occurred while processing queued function:", e);
                        }
                    }
                    continue;
                }


                const steps = this._stepInstances.get();
                const lastStepIdx = this._lastStepIdx.get();

                if (lastStepIdx >= this._targetStepIdx.get()) {
                    break;
                }

                // lastSuccessfulStep + 1 ... target

                const nextStep = steps[lastStepIdx + 1];
                if (!nextStep) {
                    console.warn("No next step found, stopping processing.");
                }
                if (nextStep.state.get() !== 'pending') {
                    break;
                }

                const prevStep = steps.at(lastStepIdx);

                transaction(tx => {
                    nextStep.state.set('running', tx);
                    nextStep.result.set(undefined, tx);
                });

                try {
                    const result = await nextStep.definition.step.run(prevStep ? prevStep.result.get() : undefined, {
                        onRewind: fn => {
                            nextStep.undoActions.push(fn);
                        },
                        onReset: fn => {
                            nextStep.resetActions.push(fn);
                        },
                        reportSideEffect: () => {
                            nextStep.hasSideEffect = true;
                        },
                    });
                    transaction(tx => {
                        this._lastStepIdx.set(lastStepIdx + 1, tx);
                        nextStep.state.set('done', tx);
                        nextStep.result.set(result, tx);
                    });
                } catch (error) {
                    console.error(`Error occurred while running step ${nextStep.definition.step.name}:`, error);

                    transaction(tx => {
                        nextStep.state.set('error', tx);
                        nextStep.result.set(undefined, tx);
                    });
                    break;
                }




            }

        } finally {
            this._isProcessing = false;
        }
    }

    runAfter(stepIdx: number) {
        this._targetStepIdx.set(stepIdx, undefined)
        this._process();
    }
}

class StepInstance extends Disposable {
    public readonly state = observableValue(this, 'pending' as 'pending' | 'running' | 'done' | 'error' | 'pendingRewind' | 'rewinding' | 'dead');
    public readonly result = observableValue(this, undefined as unknown);
    public readonly stale = observableValue(this, false);

    public readonly undoActions: (() => Promise<void>)[] = [];
    public readonly resetActions: (() => Promise<void>)[] = [];

    public hasSideEffect = false;


    constructor(public readonly definition: StepDefinition) {
        super();

        this.definition.step.view.recomputeInitiallyAndOnChange(this._store);
        this.stale.recomputeInitiallyAndOnChange(this._store);
        this.result.recomputeInitiallyAndOnChange(this._store);

        this._register(autorun(reader => {

            const mapStateToView = () => {
                const s = this.state.read(reader);

                switch (s) {
                    case 'pending':
                        return '⏳';
                    case 'running':
                        return '🏃‍♂️';
                    case 'done':
                        return '✅';
                    case 'error':
                        return '❌';
                    case 'pendingRewind':
                        return '⏪';
                    case 'rewinding':
                        return '⏪🏃‍♂️';
                    case 'dead':
                        return '💀';
                }
            }

            definition.step.view.set(mapStateToView(), undefined);
        }));
    }

    markAsStale(): void {
        this.stale.set(true, undefined);
    }
}

class StepDefinition {
    constructor(public readonly step: IStep) { }

    equals(other: StepDefinition): boolean {
        return this.step.run.toString() === other.step.run.toString();
    }
}

function compareSteps(stepsBefore: StepDefinition[], stepsAfter: StepDefinition[]): { equalStartCount: number, equalEndCount: number } {
    let equalStartCount = 0;
    let equalEndCount = 0;

    while (equalStartCount < stepsBefore.length && equalStartCount < stepsAfter.length && stepsBefore[equalStartCount].equals(stepsAfter[equalStartCount])) {
        equalStartCount++;
    }

    while (equalStartCount + equalEndCount < Math.min(stepsBefore.length, stepsAfter.length) && equalEndCount < stepsBefore.length && equalEndCount < stepsAfter.length
        && stepsBefore[stepsBefore.length - 1 - equalEndCount].equals(stepsAfter[stepsAfter.length - 1 - equalEndCount])) {
        equalEndCount++;
    }

    return { equalStartCount, equalEndCount };
}
