import findUp from "find-up";
import fs from "fs-extra";
import globby from "globby";
import path from "path";
import { IndexTimeStamp } from "./GitIndex";

type RefVariant = "heads" | "remotes" | "tags";

type WorkingDirectoryEntry = {
    path: string;
    metadataChangedAt: IndexTimeStamp;
    dataChangedAt: IndexTimeStamp;
};

export class GitDirectory {
    // TODO: actually compute this correctly
    static async getGitDirectoryRoot(): Promise<string> {
        const result = await findUp(".git", { type: "directory" });

        if (!result) {
            throw new Error(
                "fatal: not a git repository (or any of the parent directories): .git"
            );
        }

        return result;
    }

    static async getProjectRelativePath(pth: string): Promise<string> {
        const rootDir = await this.getGitDirectoryRoot();
        const parent = path.join(rootDir, "..");

        return pth.replace(`${parent}${path.delimiter}`, "");
    }

    static async findAllFiles(basePath: string): Promise<string[]> {
        const directoryPaths = await fs.readdir(basePath);
        const results: string[] = [];
        for (const stub of directoryPaths) {
            const entry = path.join(basePath, stub);
            const stat = await fs.stat(entry);

            if (stat.isDirectory()) {
                const subResults = await this.findAllFiles(entry);
                results.push(...subResults);
            } else {
                results.push(entry);
            }
        }

        return results;
    }

    static async getIndexPath(): Promise<string> {
        const baseDir = await this.getGitDirectoryRoot();
        return path.join(baseDir, "index");
    }

    static async findAllRefs(variants: RefVariant[]): Promise<string[]> {
        const gitRoot = await this.getGitDirectoryRoot();
        const basePath = path.join(gitRoot, "refs");
        const results: string[] = [];

        for (const variant of variants) {
            const filePaths = await this.findAllFiles(
                path.join(basePath, variant)
            );
            results.push(
                ...filePaths.map((p) => p.replace(gitRoot, "").substring(1))
            );
        }

        return results;
    }

    static async getPackFileNames() {
        const directory = path.join(
            await this.getGitDirectoryRoot(),
            "objects",
            "pack"
        );
        const directoryPaths = await fs.readdir(directory);
        return directoryPaths
            .filter((p) => p.toLowerCase().endsWith(".pack"))
            .map((stub) => path.join(directory, stub));
    }

    static async getObjectPath(hash: string): Promise<string> {
        const hashFolder = hash.slice(0, 2);
        const remainingHash = hash.slice(2);

        const rootDirectory = await this.getGitDirectoryRoot();
        return path.join(rootDirectory, "objects", hashFolder, remainingHash);
    }

    static async getRefPath(ref: string): Promise<string> {
        const rootDirectory = await this.getGitDirectoryRoot();

        return path.join(rootDirectory, ref);
    }

    static async getHeadPath(): Promise<string> {
        const rootDirectory = await this.getGitDirectoryRoot();

        return `${rootDirectory}/HEAD`;
    }

    static async getGitIgnore(): Promise<string[]> {
        const gitIgnore = await this.getProjectRelativePath(".gitignore");
        const ignoreExists = await fs.exists(gitIgnore);

        if (!ignoreExists) {
            return [];
        }

        const file = await fs.readFile(gitIgnore, "utf-8");
        return file
            .split("\n")
            .map((l) => l.trim())
            .filter((t) => !!t.length);
    }

    static async walkDirectory(): Promise<WorkingDirectoryEntry[]> {
        const ignoreGlobs = await this.getGitIgnore();
        const filePaths = await globby(
            ["**/**", ".gitignore", ...ignoreGlobs.map((g) => `!${g}`)],
            {
                expandDirectories: true,
                ignore: [".git", ".git/*"],
                objectMode: true,
                stats: true,
            }
        );

        return Promise.all(
            filePaths.map<Promise<WorkingDirectoryEntry>>(async (entry) => {
                if (!entry.stats) {
                    throw new Error("Failed to stat file");
                }

                return {
                    path: entry.path,
                    dataChangedAt: {
                        seconds: Math.floor(entry.stats.mtimeMs / 1000),
                        nanosecondFraction: Math.floor(
                            (entry.stats.mtimeMs -
                                Math.floor(entry.stats.mtimeMs / 1000) * 1000) *
                                1000000
                        ),
                    },
                    metadataChangedAt: {
                        seconds: Math.floor(entry.stats.ctimeMs / 1000),
                        nanosecondFraction: Math.floor(
                            (entry.stats.ctimeMs -
                                Math.floor(entry.stats.ctimeMs / 1000) * 1000) *
                                1000000
                        ),
                    },
                };
            })
        );
    }
}
