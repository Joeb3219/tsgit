import path from "path";

export class GitDirectory {
    // TODO: actually compute this correctly
    static async getGitDirectoryRoot(): Promise<string> {
        return `.git`;
    }

    static async getObjectPath(hash: string): Promise<string> {
        const hashFolder = hash.slice(0, 2);
        const remainingHash = hash.slice(2);

        const rootDirectory = await this.getGitDirectoryRoot();
        return path.join(rootDirectory, 'objects', hashFolder, remainingHash);
    }
}