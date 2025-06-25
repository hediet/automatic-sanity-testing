import { DisposableStore } from "./disposables";
import { StepsRunner } from "./steps/StepsRunner";
import { hotReloadExportedItem } from "@hediet/node-reload";
import { getSteps } from "./steps";
import { ArtifactRef, getArch, getOs, VsCodeArtifactName } from "./vscode/getDownloadUrl";

export function run() {
    const store = new DisposableStore();

    async function main() {

        const runner = store.add(new StepsRunner());

        const artifact = new ArtifactRef(
            'cb0c47c0cfaad0757385834bd89d410c78a856c0',
            VsCodeArtifactName.build({
                arch: getArch(),
                os: getOs(),
                type: 'desktop',
                flavor: 'archive',
            }),
            "stable",
        );

        store.add(hotReloadExportedItem(getSteps, f => {
            const store = new DisposableStore();
            const steps = f(store, artifact);
            runner.update(steps);

            console.log("Steps updated", steps);

            return {
                dispose: () => {
                    store.dispose();
                }
            }
        }));


        await runner.getFinalResult();

    }

    main();

    return store;
}
