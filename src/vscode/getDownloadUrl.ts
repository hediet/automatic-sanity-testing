import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

export class ArtifactRef {
    constructor(
        public readonly commit: string,
        public readonly artifact: VsCodeArtifactName,
        public readonly stability: 'stable' | 'insider',
    ) { }

    getDownloadInfoUrl(): string {
        return `https://update.code.visualstudio.com/api/versions/commit:${this.commit}/${this.artifact}/${this.stability}`;
    }

    async getDownloadInfo(): Promise<DownloadInfo> {
        const response = await fetch(this.getDownloadInfoUrl());
        if (!response.ok) {
            throw new Error(`Failed to fetch download info: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }

    async getDownloadUrl(): Promise<string> {
        const info = await this.getDownloadInfo();
        return info.url;
    }

    async getFileName(): Promise<string> {
        const url = await this.getDownloadUrl();
        return basename(url);
    }

    async download(): Promise<{ buffer: ArrayBuffer, fileName: string }> {
        const url = await this.getDownloadUrl();

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download artifact: ${response.status} ${response.statusText}`);
        }
        const buffer = await response.arrayBuffer();
        const fileName = basename(url);
        return { buffer, fileName };
    }

    async downloadToDir(dir: string): Promise<{ path: string }> {
        const { buffer, fileName } = await this.download();
        await mkdir(dir, { recursive: true });
        const path = join(dir, fileName);
        await writeFile(path, Buffer.from(buffer));
        return { path };
    }

    toString(): string {
        return `${this.commit}_${this.artifact}_${this.stability}`;
    }
}

type ArtifactProps = {
    type: 'desktop' | 'cli' | 'server';
    arch: 'x64' | 'arm64' | 'armhf';
    os: 'linux' | 'linux-deb' | 'linux-rpm' | 'linux-snap'
    | 'darwin' | 'win32' | 'alpine';
    flavor?: /*only for server */'web' | /* only for desktop-win32 */ 'user' | 'archive';
};

export class VsCodeArtifactName {
    public static build(data: ArtifactProps): VsCodeArtifactName {
        const { type, arch, os } = data;
        const typePrefix = type === 'desktop' ? '' : `${type}-`;
        const flavorSuffix = data.flavor ? `-${data.flavor}` : '';

        const name = `${typePrefix}${os}-${arch}${flavorSuffix}`;

        if (!VsCodeArtifactName.validNames.includes(name)) {
            throw new Error(`Invalid artifact name: ${name}`);
        }
        return new VsCodeArtifactName(name, data);
    }

    private static validNames = [
        "cli-alpine-arm64",
        "cli-linux-x64",
        "cli-alpine-x64",
        "cli-linux-arm64",
        "cli-linux-armhf",
        "web-standalone",
        "server-linux-alpine",
        "server-alpine-arm64",
        "cli-win32-x64",
        "cli-win32-arm64",
        "server-linux-alpine-web",
        "server-alpine-arm64-web",
        "cli-darwin-x64",
        "cli-darwin-arm64",
        "server-linux-arm64",
        "server-linux-arm64-web",
        "server-linux-armhf-web",
        "linux-arm64",
        "linux-armhf",
        "linux-deb-arm64",
        "linux-deb-armhf",
        "server-linux-armhf",
        "linux-rpm-armhf",
        "linux-rpm-arm64",
        "server-darwin-arm64",
        "win32-arm64-archive",
        "server-darwin-arm64-web",
        "server-win32-arm64",
        "server-darwin-web",
        "darwin-arm64",
        "server-darwin",
        "darwin",
        "server-win32-arm64-web",
        "linux-x64",
        "win32-arm64",
        "server-linux-x64",
        "win32-arm64-user",
        "server-linux-x64-web",
        "linux-deb-x64",
        "linux-rpm-x64",
        "darwin-universal",
        "win32-x64-archive",
        "server-win32-x64",
        "win32-x64",
        "server-win32-x64-web",
        "linux-snap-x64",
        "win32-x64-user"
    ];

    constructor(
        public readonly name: string,
        public readonly props: ArtifactProps,
    ) { }

    toString(): string {
        return this.name;
    }
}


export function getArch() {
    if (process.arch === 'arm64') {
        return 'arm64';
    }
    return 'x64';
}

export function getOs() {
    switch (process.platform) {
        case 'win32':
            return 'win32';
        case 'darwin':
            return 'darwin';
        case 'linux':
            return 'linux';
        default:
            throw new Error(`Unsupported platform: ${process.platform}`);
    }
}

interface DownloadInfo {
    url: string;
    name: string;
    version: string;
    productVersion: string;
    hash: string;
    timestamp: number;
    sha256hash: string;
    supportsFastUpdate: boolean;
}