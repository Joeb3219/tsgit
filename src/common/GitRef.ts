import fs from "fs-extra";
import path from "path";
import { GitDirectory } from "./GitDirectory";
export class GitRef {
    static async updateRef(refName: string, refValue: string) {
        const refPath = await GitDirectory.getRefPath(refName);

        if (!this.isRefsStyle(refName)) {
            throw new Error("Provided name is not a valid ref name");
        }

        const baseDirectory = path.dirname(refPath);

        await fs.mkdirp(baseDirectory);

        console.log(
            `writing ${refValue.trim()} (${refValue.length}) to ${refPath}`
        );
        return fs.writeFile(refPath, `${refValue.trim()}\n`, {
            encoding: "utf-8",
        });
    }

    static async getCurrentRef(): Promise<string> {
        const headPath = await GitDirectory.getHeadPath();
        const data = await fs.readFile(headPath, { encoding: "utf-8" });
        const result = data.split("ref: ")[1]?.trim();

        if (!result) {
            throw new Error("Failed to find HEAD ref");
        }

        return result;
    }

    // TODO: use opaque type and make this a type guard
    static isRefsStyle(str: string): boolean {
        return (
            str.startsWith("refs/heads/") ||
            str.startsWith("refs/tags/") ||
            str.startsWith("refs/remotes/")
        );
    }

    static async updateCurrentRef(newRef: string) {
        const headPath = await GitDirectory.getHeadPath();

        if (!this.isRefsStyle(newRef)) {
            throw new Error("Provided name is not a valid ref name");
        }

        return fs.writeFile(headPath, `ref: ${newRef.trim()}`, {
            encoding: "utf-8",
        });
    }

    static async getRef(refName: string) {
        const refPath = await GitDirectory.getRefPath(refName);

        const result = await fs.readFile(refPath, { encoding: "utf-8" });
        return result.trim();
    }

    static async deleteRef(refName: string) {
        const refPath = await GitDirectory.getRefPath(refName);

        return fs.remove(refPath);
    }

    static refToBranchName(ref: string): string {
        return ref.replace(/refs\/(heads|remotes)\//gi, "").trim();
    }

    // Returns a Record of <refString, Commit>
    static async getAllBranchRefs(
        includeRemote: boolean
    ): Promise<Record<string, string>> {
        const refs = await GitDirectory.findAllRefs(
            includeRemote ? ["heads", "remotes"] : ["heads"]
        );
        const result: Record<string, string> = {};

        for (const ref of refs) {
            const commit = await this.getRef(ref);
            result[ref] = commit;
        }

        return result;
    }
}
