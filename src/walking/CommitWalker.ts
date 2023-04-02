import fs from "fs-extra";
import { GitDirectory } from "../common/GitDirectory";
import { GitObject, GitObjectData, TreeData } from "../common/GitObject";
import { GitPack } from "../common/GitPack";
import { GitRef } from "../common/GitRef";

type GitAuthor = {
    nameAndEmail: string;
    date: Date;
    timezone: string;
};

type GitCommitRaw = {
    id: string;
    author: GitAuthor;
    committer: GitAuthor;
    commitMsg: string;
    tree: string;
    parentIds: string[];
};

export type GitCommit = {
    id: string;
    author: GitAuthor;
    committer: GitAuthor;
    commitMsg: string;
    tree: string;
    parents: GitCommit[];
};

// TODO: a better name than walking
export class CommitWalker {
    static async findCurrentCommitAndAncestors(): Promise<GitCommit> {
        const currentBranch = await GitRef.getCurrentRef();
        const currentCommit = await GitRef.getRef(currentBranch);

        return this.findCommitAndAncestors(currentCommit);
    }

    static async findObject(id: string): Promise<GitObjectData> {
        const objectDirectPath = await GitDirectory.getObjectPath(id);
        const objectDirectPathExists = await fs.pathExists(objectDirectPath);
        if (objectDirectPathExists) {
            return await GitObject.readObjectFromDisk(id);
        }

        // Otherwise we'll find a pack file for it.
        const packFiles = await GitDirectory.getPackFileNames();
        for (const packFileName of packFiles) {
            const pack = await GitPack.readGitPack(
                packFileName,
                packFileName.replace(".pack", ".idx")
            );
            const objectWithId = pack.entries.find((entry) => entry.id === id);
            if (objectWithId) {
                if ("object" in objectWithId) {
                    return objectWithId.object;
                }

                throw new Error(
                    `Currently cannot handle deltaified entries, and ${id} is deltaified`
                );
            }
        }

        throw new Error(`Failed to find object with with ID ${id}`);
    }

    static stringToAuthor(str: string): GitAuthor {
        const dataLeftOfSpace = str.substring(str.indexOf(" ") + 1);
        const matches = [
            ...dataLeftOfSpace.matchAll(/(.*) (\d{10}) ([+-][0-9]*)/gm),
        ];
        const [_match, nameAndEmail, time, timezone] = matches[0];

        return {
            nameAndEmail,
            timezone,
            // Convert seconds to ms
            date: new Date(parseInt(time, 10) * 1_000),
        };
    }

    static objectToCommit(object: GitObjectData): GitCommitRaw {
        if (object.type !== "commit") {
            throw new Error(
                `Attempting to convert object to commit when given a non-commit`
            );
        }

        const lines = object.data.split("\n");
        const treeLine = lines.find((f) => f.startsWith("tree "));
        const authorLine = lines.find((f) => f.startsWith("author "));
        const committerLine = lines.find((f) => f.startsWith("committer "));

        if (!authorLine || !committerLine || !treeLine) {
            throw new Error("Commit has no author/committer/tree");
        }

        const committerLineIndex = lines.indexOf(committerLine);
        const commitMsg = lines
            .slice(committerLineIndex + 1)
            .join("\n")
            .trim();

        return {
            commitMsg,
            id: object.hash,
            author: this.stringToAuthor(authorLine),
            committer: this.stringToAuthor(committerLine),
            tree: treeLine.split(" ")[1].trim(),
            parentIds: lines
                .filter(
                    (l, idx) =>
                        l.startsWith("parent") && idx < committerLineIndex
                )
                .map((l) => l.split(" ")[1]),
        };
    }

    static async findCommitAndAncestors(commitId: string): Promise<GitCommit> {
        const object = await this.findObject(commitId);
        const baseCommit = this.objectToCommit(object);

        return {
            ...baseCommit,
            parents: await Promise.all(
                baseCommit.parentIds.map(async (parentId) =>
                    this.findCommitAndAncestors(parentId)
                )
            ),
        };
    }

    static async restoreTree(tree: GitObjectData) {
        if (tree.type !== "tree") {
            throw new Error(`Attempting to restore tree with non-tree object`);
        }

        for (const node of tree.data) {
            const childObject = await this.findObject(node.hash);

            if (childObject.type === "tree") {
                this.restoreTree(childObject);
                return;
            }

            // TODO: set the file mode
            await fs.writeFile(node.path, childObject.data);
        }
    }

    static async getCurrentTree() {
        const currentBranch = await GitRef.getCurrentRef();
        const currentCommitId = await GitRef.getRef(currentBranch);
        const commitObject = await this.findObject(currentCommitId);
        const currentCommit = this.objectToCommit(commitObject);

        return this.findObject(currentCommit.tree);
    }

    static async flattenTree(tree: GitObjectData): Promise<TreeData[]> {
        const rows: TreeData[] = [];

        if (tree.type !== "tree") {
            throw new Error(
                `Attempting to flatten a tree when given non-tree object`
            );
        }

        for (const node of tree.data) {
            rows.push(node);
            if (node.type === "tree") {
                const object = await this.findObject(node.hash);
                const subNodes = await this.flattenTree(object);
                rows.push(...subNodes);
            }
        }

        return rows;
    }
}
