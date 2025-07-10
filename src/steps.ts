import { dirname, join } from "node:path";
import { IAutomationDriver, UINode } from "./automationDriver";
import { DisposableStore } from "./disposables";
import { composedStep, step, steps } from "./steps/steps";
import { WindowsAutomationDriver } from "./windows";
import { existsSync, mkdirSync } from "node:fs";
import { ArtifactRef } from "./vscode/getDownloadUrl";
import { writeFile } from "node:fs/promises";
import AdmZip = require("adm-zip");

const appDataLocal = process.env.LOCALAPPDATA!;
const vsCodeInstallPath = join(appDataLocal, "Programs/Microsoft VS Code");
const vsCodeExecutablePath = join(vsCodeInstallPath, "Code.exe");
const uninstPathUserInstaller = join(vsCodeInstallPath, "unins000.exe");

export const outputDir = join(__dirname, "../output");

export function getSteps(store: DisposableStore, artifactRef: ArtifactRef) {
    return steps(
        step({ name: 'Download Artifact if it does not exist' }, async (args, ctx) => {
            const targetDir = join(__dirname, "../temp", artifactRef.toString());

            let artifactPath: string;
            if (!existsSync(targetDir)) {
                const result = await artifactRef.downloadToDir(targetDir);
                artifactPath = result.path;
                console.log("VS Code installer downloaded successfully");
            } else {
                artifactPath = join(targetDir, await artifactRef.getFileName());
            }
            return { artifactPath };
        }),
        step({ name: 'Driver Setup' }, async (args, ctx) => {
            const driver: IAutomationDriver = await WindowsAutomationDriver.create();
            return { driver, ...args };
        }),

        artifactRef.artifact.props.flavor === 'archive' ? getRunFromArchiveSteps() : getSetupSteps(),

        step({ name: 'WaitForApp' }, async ({ driver }, ctx) => {
            const w = await waitFor(async () => {
                const p = await driver.findRootProcesses({ executableName: 'Code.exe' });
                const window = p.map(e => e.getAllWindows()[0]).find(e => e !== undefined);
                return window;
            }, { timeoutMs: 30 * 1000 });

            await waitMs(10 * 1000);

            const screenshot = await driver.createScreenshot(w.rect);
            const screenshotPath = join(outputDir, 'screenshot.png');
            await writeFile(screenshotPath, Buffer.from(screenshot.base64Png, 'base64'));

            return { driver };
        }),
    );
}


function getSetupSteps() {
    return composedStep<{ driver: IAutomationDriver, artifactPath: string }>()(
        step({ name: 'Start Setup' }, async ({ driver, artifactPath }, ctx) => {
            if (existsSync(uninstPathUserInstaller)) {
                const process = await driver.createProcess(uninstPathUserInstaller);
                const btn = await process.waitForUINode(e => e.text === 'Yes');
                driver.clickElement(btn);
                await process.waitForExit();
            }
            const p = await driver.createProcess(artifactPath);
            ctx.onReset(async () => await p.kill());
            return { driver, process: p };
        }),

        step({ name: 'License agreement' }, async ({ driver, process }, ctx) => {
            const isAdminDialog = (e: UINode) => !!e.text?.startsWith('This User Installer is not meant to be run as an Administrator.');
            const e = await process.waitForUINode(e => e.type === 'pane' && e.text === 'License Agreement' || isAdminDialog(e));
            if (isAdminDialog(e)) {
                const okButton = await process.waitForUINode(e => e.type === 'button' && e.text === 'OK');
                ctx.reportSideEffect();
                await driver.clickElement(okButton);
                await process.waitForUINode(e => e.type === 'pane' && e.text === 'License Agreement');
            }

            const radioButton = await process.waitForUINode(e => e.type === 'radio button' && e.text === 'I accept the agreement');
            ctx.reportSideEffect();
            await driver.clickElement(radioButton);

            const nextButton = await process.waitForUINode(e => e.type === 'button' && e.text === 'Next');
            await driver.clickElement(nextButton);
            return { driver, process };
        }),

        step({ name: 'Installation Path' }, async ({ driver, process }, ctx) => {
            await process.waitForUINode(e => e.type === 'pane' && e.text === 'Select Destination Location');
            const nextButton = await process.waitForUINode(e => e.type === 'button' && e.text === 'Next');
            ctx.reportSideEffect();
            await driver.clickElement(nextButton);
            return { driver, process };
        }),
        step({ name: 'Startmenu' }, async ({ driver, process }, ctx) => {
            await process.waitForUINode(e => e.type === 'pane' && e.text === 'Select Start Menu Folder');
            const nextButton = await process.waitForUINode(e => e.type === 'button' && e.text === 'Next');
            ctx.reportSideEffect();
            await driver.clickElement(nextButton);
            return { driver, process };
        }),
        step({ name: 'Additional tasks' }, async ({ driver, process }, ctx) => {
            await process.waitForUINode(e => e.type === 'pane' && e.text === 'Select Additional Tasks');
            const nextButton = await process.waitForUINode(e => e.type === 'button' && e.text === 'Next');
            ctx.reportSideEffect();
            await driver.clickElement(nextButton);
            return { driver, process };
        }),
        step({ name: 'Install' }, async ({ driver, process }, ctx) => {
            await process.waitForUINode(e => e.type === 'pane' && e.text === 'Ready to Install');
            const nextButton = await process.waitForUINode(e => e.type === 'button' && e.text === 'Install');
            ctx.reportSideEffect();
            await driver.clickElement(nextButton);
            return { driver, process };
        }),
        step({ name: 'Finish' }, async ({ driver, process }, ctx) => {
            await process.waitForUINode(e => e.type === 'pane' && e.text?.trim() === 'Completing the Visual Studio Code Setup Wizard', { timeoutMs: 10 * 60 * 1000 });
            const nextButton = await process.waitForUINode(e => e.props.ClassName === 'TNewButton' && e.text === 'Finish');
            ctx.reportSideEffect();
            await driver.clickElement(nextButton);
            return { driver };
        }),
    );
}

function getRunFromArchiveSteps() {
    return composedStep<{ driver: IAutomationDriver, artifactPath: string }>()(
        step({ name: 'Extract artifact' }, async ({ driver, artifactPath }, ctx) => {
            const dir = dirname(artifactPath);
            const extractedDir = join(dir, 'extracted');

            if (!existsSync(extractedDir)) {
                console.log(`Extracting ${artifactPath} to ${extractedDir}`);
                mkdirSync(extractedDir, { recursive: true });

                const zip = new AdmZip(artifactPath);
                zip.extractAllTo(extractedDir, true);
                console.log('Extraction completed');
            } else {
                console.log('Archive already extracted');
            }

            const p = await driver.createProcess(join(extractedDir, 'Code.exe'));
            ctx.onReset(async () => await p.kill());
            return { driver, process: p };
        }),
    );
}


function waitMs(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function waitFor<T>(callback: () => Promise<T | undefined>, options: { timeoutMs?: number } = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? 20 * 1000;
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let delay = 500;
        const maxDelay = 3000;

        const tryCallback = async () => {
            try {
                const result = await callback();
                if (result !== undefined) {
                    resolve(result);
                    return;
                }
            } catch (error) {
                // Continue trying on error
            }

            if (Date.now() - startTime >= timeoutMs) {
                reject(new Error('Timeout waiting for condition'));
                return;
            }

            setTimeout(tryCallback, Math.min(delay, maxDelay));
            delay = Math.min(delay * 1.5, maxDelay);
        };

        tryCallback();
    });
}