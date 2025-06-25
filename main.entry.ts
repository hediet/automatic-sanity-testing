import { Command } from "commander";
import { DisposableStore } from "./src/disposables";
import { getSteps } from "./src/steps";
import { StepsRunner } from "./src/steps/StepsRunner";
import { ScreenRecording } from "./src/ScreenRecording";
import { ArtifactRef, VsCodeArtifactName, getArch, getOs } from "./src/vscode/getDownloadUrl";


async function main() {
    const program = new Command();

    program
        .name("automatic-sanity-testing")
        .description("Automated sanity testing tool")
        .version("1.0.0")
        .requiredOption("-t, --target <target>", "Target environment (user, system, or archive)")
        .parse();

    const options = program.opts();
    const target = options.target as string;
    const artifact = new ArtifactRef(
        'cb0c47c0cfaad0757385834bd89d410c78a856c0',
        VsCodeArtifactName.build({
            arch: getArch(),
            os: getOs(),
            type: 'desktop',
            flavor: ({
                "user": 'user',
                "archive": 'archive',
                "system": undefined,
            } as any)[target],
        }),
        "stable",
    );

    console.log(`Running automated sanity testing for target: ${target}`);
    const store = new DisposableStore();

    const recording = store.add(await ScreenRecording.record("output.mp4"));

    const runner = store.add(new StepsRunner(getSteps(store, artifact)));
    try {
        await runner.getFinalResult();
        console.log("Steps completed successfully");
    } catch (e) {
        console.error("An error occurred during the steps execution:", e);
    }

    await recording.stop();

    store.dispose();

    process.exit();
}

main();
