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

        return fs.writeFile(refPath, refValue, { encoding: "utf-8" });
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

        return fs.writeFile(headPath, `ref: ${newRef}`, { encoding: "utf-8" });
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
}
