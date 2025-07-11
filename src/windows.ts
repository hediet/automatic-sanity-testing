import { IAutomationDriver, Image, UINode, IProcess, Rect, Point, IWaitOptions, ProcessTree } from "./automationDriver";
import { spawn, ChildProcess } from "child_process";
import { exec } from "node:child_process";
import { Disposable } from "./disposables";
import { ConsoleRpcLogger, contract, NodeJsMessageStreamWithHeaders, requestType, TypedChannel } from "@hediet/json-rpc-node";
import { join } from "node:path";
import z, { ZodType } from "zod";

function runVsCodeCommand(commandId: string, ...args: unknown[]) {
    interface ISimpleSet<T> {
        add(value: T): void;
        delete(value: T): void;
    }
    interface GlobalObj {
        $$debugValueEditor_runVsCodeCommand?: (commandId: string, ...args: unknown[]) => void;
        $$debugValueEditor_onConnected?: ISimpleSet<() => void>;
    }

    const g = globalThis as any as GlobalObj;
    (g.$$debugValueEditor_onConnected = g.$$debugValueEditor_onConnected || new Set()).add(() => {
        g.$$debugValueEditor_runVsCodeCommand!(commandId, ...args);
    });

}

export class WindowsAutomationDriver extends Disposable implements IAutomationDriver {
    private server: ReturnType<typeof c.getServer>;

    static async create(): Promise<WindowsAutomationDriver> {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for the .NET process to start
        const d = new WindowsAutomationDriver();
        await d.initialized;
        return d;
    }

    private readonly initialized: Promise<void>;

    constructor() {
        super();

        const proc = spawn('dotnet', ['run'], {
            cwd: join(__dirname, '..', 'windowsAutomationDriver'),
            stdio: ['pipe', 'pipe', 'pipe']
        });

        proc.stderr.on('data', (data) => {
            console.error(`Process output: ${data}`);
        });
        this._store.add({ dispose: () => { proc.kill(); } });

        const t = TypedChannel.fromStream(NodeJsMessageStreamWithHeaders.connectToProcess(proc), {
            logger: new ConsoleRpcLogger()
        })
        this.server = c.getServer(t, {});
        t.startListen();

        this.initialized = this.server.server.getProcessId().then((processId) => {
            runVsCodeCommand('debug-value-editor.startDebugging', {
                launchConfig: {
                    name: 'Windows Automation Driver',
                    type: 'coreclr',
                    request: 'attach',
                    processId: processId,
                },
            });
        });
    }

    async createProcess(executablePath: string, args: string[] = []): Promise<IProcess> {
        return new Promise((resolve, reject) => {
            const childProcess = spawn(executablePath, args, {
                detached: true,
                stdio: 'ignore'
            });

            childProcess.on('error', reject);
            childProcess.on('spawn', () => {
                const process = new NodeChildProcess(childProcess, this);
                resolve(process);
            });
        });
    }

    async findRootProcesses(options: { executablePath?: string; executableName?: string }): Promise<ProcessTree[]> {
        const processTree = await this.server.server.getProcessTreeByExePath({ executablePath: options.executablePath, executableName: options.executableName });
        const convertProcessTreeToProcesses = (tree: IProcessTreeInfo): ProcessTree => {
            const process: IProcess = new WindowsProcess(tree.processId, this);
            const children: ProcessTree[] = tree.children.map(convertProcessTreeToProcesses);
            const windows = tree.windows.map(w => new UINode(undefined, 'window-hwnd-' + w.handle, 'window', w.title, undefined, {}, []));
            return new ProcessTree(process, children, windows);
        };

        return processTree.map(t => convertProcessTreeToProcesses(t));
    }

    async createScreenshot(rect?: Rect): Promise<Image> {
        const screenshotRect = rect ? {
            x: rect.topLeft.x,
            y: rect.topLeft.y,
            width: rect.bottomRight.x - rect.topLeft.x,
            height: rect.bottomRight.y - rect.topLeft.y
        } : undefined;

        const base64Png = await this.server.server.takeScreenshot({ rect: screenshotRect });
        return new Image(base64Png);
    }

    async getUINode(): Promise<UINode> {
        const result = await this.server.server.getUiTree();
        return this.convertToUINode(result);
    }

    async getUiTreeForProcess(processId: number, includeChildProcesses: boolean): Promise<UINode> {
        const result = await this.server.server.getUiTreeForProcess({ processId, includeChildProcesses });
        return this.convertToUINode(result);
    }

    async clickElement(node: UINode): Promise<void> {
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.server.server.clickElement({ elementId: node.id });
    }

    async revealElement(node: UINode): Promise<void> {
        await this.server.server.revealElement({ elementId: node.id });
    }

    async sendKey(key: string): Promise<void> {
        await this.server.server.sendKey({ key });
    }

    async sendText(text: string): Promise<void> {
        await this.server.server.sendText({ text });
    }

    private convertToUINode(node: any, parent: UINode | undefined = undefined): UINode {
        const children: UINode[] = [];
        const n = new UINode(
            parent,
            node.id,
            node.type,
            node.text,
            node.rect ? new Rect(
                new Point(node.rect.x, node.rect.y),
                new Point(node.rect.x + node.rect.width, node.rect.y + node.rect.height)
            ) : undefined,
            node.props || {},
            children,
        );
        children.push(...(node.children?.map((child: any) => this.convertToUINode(child, n)) || []));
        return n;
    }
}


const zProcessTreeInfo: ZodType<IProcessTreeInfo> = z.lazy(() => z.object({
    processId: z.number(),
    processName: z.string(),
    windows: z.array(z.object({
        processId: z.number(),
        processName: z.string(),
        title: z.string(),
        handle: z.number(),
        elementCount: z.number()
    })),
    children: z.array(zProcessTreeInfo),
}));

interface IProcessTreeInfo {
    processId: number;
    processName: string;
    windows: {
        processId: number;
        processName: string;
        title: string;
        handle: number;
        elementCount: number;
    }[];
    children: IProcessTreeInfo[];
}

const c = contract({
    name: 'windowsAutomation',
    server: {
        getProcessWindows: requestType({
            method: 'GetProcessWindows',
            params: z.object({
                processId: z.number(),
            }),
            result: z.array(z.object({
                processId: z.number(),
                processName: z.string(),
                title: z.string(),
                handle: z.number(),
                elementCount: z.number()
            })),
        }),
        getProcessTreeWindows: requestType({
            method: 'GetProcessTreeWindows',
            params: z.object({
                rootProcessId: z.number()
            }),
            result: z.object({
                processId: z.number(),
                processName: z.string(),
                windows: z.array(z.object({
                    processId: z.number(),
                    processName: z.string(),
                    title: z.string(),
                    handle: z.number(),
                    elementCount: z.number()
                })),
                children: z.array(z.object({})),
            }),
        }),
        getUiTree: requestType({
            method: 'GetUiTree',
            result: z.object({
                id: z.string(),
                type: z.string(),
                text: z.string(),
                children: z.array(z.any()), // Recursive structure
                rect: z.object({
                    x: z.number(),
                    y: z.number(),
                    width: z.number(),
                    height: z.number()
                }).optional(),
                props: z.record(z.any())
            }),
        }),
        getUiTreeForProcess: requestType({
            method: 'GetUiTreeForProcess',
            params: z.object({
                processId: z.number(),
                includeChildProcesses: z.boolean().default(false),
            }),
            result: z.object({
                id: z.string(),
                type: z.string(),
                text: z.string(),
                children: z.array(z.any()), // Recursive structure
                rect: z.object({
                    x: z.number(),
                    y: z.number(),
                    width: z.number(),
                    height: z.number()
                }).optional(),
                props: z.record(z.any())
            }),
        }),
        clickElement: requestType({
            method: 'ClickElement',
            params: z.object({
                elementId: z.string(),
            }),
            result: z.null(),
        }),
        revealElement: requestType({
            method: 'RevealElement',
            params: z.object({
                elementId: z.string(),
            }),
            result: z.null(),
        }),
        takeScreenshot: requestType({
            method: 'TakeScreenshot',
            params: z.object({
                rect: z.object({
                    x: z.number(),
                    y: z.number(),
                    width: z.number(),
                    height: z.number()
                }).optional(),
            }),
            result: z.string(), // Base64 PNG
        }),
        getVersion: requestType({
            method: 'GetVersion',
            result: z.string(),
        }),
        getProcessId: requestType({
            method: 'GetProcessId',
            result: z.number(),
        }),
        getProcessTreeByExePath: requestType({
            method: 'GetProcessTreeByExePath',
            params: z.object({
                executablePath: z.string().optional(),
                executableName: z.string().optional(),
            }),
            result: z.array(zProcessTreeInfo),
        }),
        sendKey: requestType({
            method: 'SendKey',
            params: z.object({
                key: z.string(),
            }),
            result: z.null(),
        }),
        sendText: requestType({
            method: 'SendText',
            params: z.object({
                text: z.string(),
            }),
            result: z.null(),
        }),
    },
    client: {},
});

abstract class BaseWindowsProcess implements IProcess {
    public readonly id: number;

    constructor(
        private readonly _processId: number,
        protected readonly _driver: WindowsAutomationDriver,
    ) {
        this.id = _processId;
    }

    async getUINode(): Promise<UINode> {
        return await this._driver.getUiTreeForProcess(this.id, true);
    }

    async waitForUINode(predicate: (node: UINode) => boolean, options?: IWaitOptions): Promise<UINode> {
        let attempts = 0;
        const maxAttempts = (options?.timeoutMs ?? 15_000) / 500;
        while (true) {
            const tree = await this._driver.getUiTreeForProcess(this.id, true);

            const node = tree.find(predicate);
            if (node) {
                return node;
            }
            if (attempts++ > maxAttempts) {
                throw new Error(`Timeout waiting for UI node matching predicate after ${attempts} attempts.`);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }

    async kill(): Promise<void> {
        console.log(`Killing process with ID ${this.id}`);
        return new Promise<void>((resolve, reject) => {
            exec(`taskkill /pid ${this.id} /t /f`, (error) => {
                reject(error || new Error(`Failed to kill process with ID ${this.id}`));
            });
        }).then(() => {
            console.log(`Process with ID ${this.id} killed successfully.`);
        });
    }

    abstract waitForExit(): Promise<number>;
}

class WindowsProcess extends BaseWindowsProcess {
    constructor(
        private readonly processId: number,
        driver: WindowsAutomationDriver,
    ) {
        super(processId, driver);
    }

    async waitForExit(): Promise<number> {
        throw new Error("Method not implemented.");
    }
}

class NodeChildProcess extends BaseWindowsProcess {
    constructor(
        private readonly childProcess: ChildProcess,
        driver: WindowsAutomationDriver,
    ) {
        super(childProcess.pid!, driver);
    }

    async waitForExit(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.childProcess.on('exit', (code) => resolve(code || 0));
            this.childProcess.on('error', reject);
        });
    }
}
