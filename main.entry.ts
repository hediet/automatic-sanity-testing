import { Command } from "commander";
import { DisposableStore } from "./src/disposables";
import { getSteps, outputDir } from "./src/steps";
import { StepsRunner } from "./src/steps/StepsRunner";
import { ScreenRecording } from "./src/ScreenRecording";
import { ArtifactRef, VsCodeArtifactName, getArch, getOs } from "./src/vscode/getDownloadUrl";
import { join } from "node:path";

async function main() {
    const program = new Command();

    program
        .name("automatic-sanity-testing")
        .description("Automated sanity testing tool")
        .version("1.0.0")
        .requiredOption("-t, --target <target>", "Target environment (user, system, or archive)")
        .requiredOption("-c, --vscode-commit <commit>", "VS Code commit hash")
        .parse();

    const options = program.opts();
    const target = options.target as string;
    const vscodeCommit = options.vscodeCommit as string;
    const artifact = new ArtifactRef(
        vscodeCommit,
        VsCodeArtifactName.build({
            arch: getArch(),
            os: getOs(),
            type: target === "server" ? "server" : "desktop",
            flavor: ({
                "user": "user",
                "archive": "archive",
                "server": "web",
                "system": undefined,
            } as any)[target],
        }),
        "stable",
    );

    console.log(`Running automated sanity testing for target: ${target}`);
    const store = new DisposableStore();

    const recording = store.add(await ScreenRecording.record(join(outputDir, "recording.mp4")));

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
