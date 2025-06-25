import { spawn, ChildProcess } from "child_process";
import { IDisposable } from "./disposables";
import { existsSync } from "fs";
import { rm } from "fs/promises";

export class ScreenRecording implements IDisposable {
    private constructor(private readonly ffmpegProcess: ChildProcess) { }

    public static async record(outputPath: string): Promise<ScreenRecording> {
        console.log("Starting screen recording...");
        if (existsSync(outputPath)) {
            await rm(outputPath, { force: true });
        }

        const ffmpegProcess = spawn("ffmpeg", [
            "-f", "gdigrab",
            "-framerate", "4", // Increased framerate for better compatibility
            "-i", "desktop",
            "-c:v", "libx264", // Explicit H.264 codec
            "-preset", "ultrafast", // Fast encoding for real-time recording
            "-crf", "23", // Good quality setting
            "-pix_fmt", "yuv420p", // Compatible pixel format
            "-movflags", "+faststart", // Optimize for streaming/quick playback
            outputPath
        ], {
            stdio: ["pipe", "inherit", "inherit"] // Enable stdin pipe for graceful shutdown
        });

        return new Promise((resolve, reject) => {
            ffmpegProcess.on("error", (error) => {
                console.error("Failed to start screen recording:", error.message);
                reject(error);
            });

            ffmpegProcess.on("spawn", () => {
                console.log("Screen recording started successfully");
                resolve(new ScreenRecording(ffmpegProcess));
            });

            // Fallback timeout in case spawn event doesn't fire
            setTimeout(() => {
                if (!ffmpegProcess.killed && ffmpegProcess.pid) {
                    resolve(new ScreenRecording(ffmpegProcess));
                }
            }, 1000);
        });
    }

    public stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.ffmpegProcess.exitCode !== null) {
                resolve();
                return;
            }

            // Set up exit handler first
            this.ffmpegProcess.on('exit', (code) => {
                console.log(`Screen recording stopped with exit code: ${code}`);
                resolve();
            });

            // Try graceful shutdown first
            if (this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
                console.log("Attempting graceful shutdown of screen recording...");
                this.ffmpegProcess.stdin.write('q');
                this.ffmpegProcess.stdin.end();

                // Set a timeout for forceful shutdown if graceful doesn't work
                setTimeout(() => {
                    if (this.ffmpegProcess.exitCode === null) {
                        console.log("Graceful shutdown timed out, forcing termination");
                        this.ffmpegProcess.kill("SIGTERM");
                        // Don't call resolve here - let the exit handler do it
                    }
                }, 10000); // Increased timeout to 10 seconds to allow proper file finalization
            } else {
                console.log("stdin not available, using SIGTERM");
                this.ffmpegProcess.kill("SIGTERM");
            }
        });
    }

    public dispose(): void {
        if (this.ffmpegProcess.exitCode === null) {
            this.ffmpegProcess.kill("SIGTERM");
        }
    }
}
