export interface IAutomationDriver {
    createScreenshot(rect?: Rect): Promise<Image>;

    getUINode(): Promise<UINode>;

    clickElement(node: UINode): Promise<void>;
    revealElement(node: UINode): Promise<void>;

    createProcess(executablePath: string, args?: string[]): Promise<IProcess>;

    findRootProcesses(options: { executablePath?: string; executableName?: string }): Promise<ProcessTree[]>;
}

export class ProcessTree {
    constructor(
        readonly process: IProcess,
        readonly children: readonly ProcessTree[],
        readonly windows: readonly UINode[],
    ) { }

    public getAllWindows(): UINode[] {
        const result: UINode[] = [];
        function collectWindows(node: UINode) {
            result.push(node);
            for (const child of node.children) {
                collectWindows(child);
            }
        }
        for (const window of this.windows) {
            collectWindows(window);
        }
        return result;
    }
}

export interface IProcess {
    id: number;
    kill(): Promise<void>;
    waitForExit(): Promise<number>;

    getUINode(): Promise<UINode>;
    waitForUINode(predicate: (node: UINode) => boolean, options?: IWaitOptions): Promise<UINode>;
}

export interface IWaitOptions {
    timeoutMs?: number;
}

export class Image {
    constructor(
        public readonly base64Png: string
    ) { }
}

export class UINode {
    constructor(
        public readonly parent: UINode | undefined,
        public readonly id: string,
        public readonly type: string,
        public readonly text: string | undefined,
        public readonly rect: Rect | undefined,
        public readonly props: Record<string, unknown>,
        public readonly children: UINode[],
    ) { }

    public previousSibling(): UINode | undefined {
        if (!this.parent) {
            return undefined;
        }

        const index = this.parent.children.indexOf(this);
        if (index > 0) {
            return this.parent.children[index - 1];
        }
    }

    public nextSibling(): UINode | undefined {
        if (!this.parent) {
            return undefined;
        }

        const index = this.parent.children.indexOf(this);
        if (index < this.parent.children.length - 1) {
            return this.parent.children[index + 1];
        }
    }

    toString(recursive: true): string {
        if (!recursive) {
            return `UINode(${this.id}, ${this.type}, ${this.text}, ${this.rect?.toString()})`;
        }

        function formatNode(node: UINode, indent: string): string {
            const childrenStr = node.children.map(child => formatNode(child, indent + '  ')).join('\n');
            return `${indent}UINode(${node.id}, ${node.type}, ${node.text}, ${node.rect?.toString()})\n${childrenStr}`;
        }
        return formatNode(this, '');
    }

    find(predicate: (node: UINode) => boolean): UINode | undefined {
        if (predicate(this)) {
            return this;
        }
        for (const child of this.children) {
            const result = child.find(predicate);
            if (result) {
                return result;
            }
        }
    }

    findLast(predicate: (node: UINode) => boolean): UINode | undefined {
        if (predicate(this)) {
            return this;
        }

        for (let i = this.children.length - 1; i >= 0; i--) {
            const child = this.children[i];
            const result = child.findLast(predicate);
            if (result) {
                return result;
            }
        }
    }


    toJson(): unknown {
        return {
            id: this.id,
            type: this.type,
            text: this.text,
            rect: this.rect,
            props: this.props,
            children: this.children.map(child => child.toJson()),
        };
    }
}

export class Rect {
    constructor(
        public readonly topLeft: Point,
        public readonly bottomRight: Point
    ) { }

    toString(): string {
        return `Rect(${this.topLeft.toString()}, ${this.bottomRight.toString()})`;
    }
}

export class Point {
    constructor(
        public readonly x: number,
        public readonly y: number,
    ) { }

    toString(): string {
        return `(${this.x}, ${this.y})`;
    }
}
