import _ from "lodash";
import path from "path";
import { GitCommitRaw } from "../walking/CommitWalker";
import { GitIndex, GitIndexDataRow } from "./GitIndex";
import { GitObject, GitObjectData, TreeData } from "./GitObject";
import { GitRef } from "./GitRef";
import { HashUtil } from "./Hash.util";

export class GitCommitBuilder {
    static async createCommitFromStagingArea(commitMsg?: string) {
        const index = await GitIndex.readIndex();
        const newTree = await this.indexToTree(index);
        const rootTree = newTree["."];
        const currentBranch = await GitRef.getCurrentRef();
        const currentCommit = await GitRef.getRef(currentBranch);

        if (!rootTree) {
            throw new Error("No root tree found");
        }

        // Write all of our trees!
        await Promise.all(
            Object.values(newTree).map((subTree) =>
                GitObject.writeObject(subTree)
            )
        );

        // Now we generate the commit!
        const commitDate = new Date();
        const commit = this.generateCommit({
            // TOOD: actually compute these
            author: {
                nameAndEmail: `Joseph A. Boyle <joseph.a.boyle@rutgers.edu>`,
                date: commitDate,
                timezone: "-0400",
            },
            committer: {
                nameAndEmail: `Joseph A. Boyle <joseph.a.boyle@rutgers.edu>`,
                date: commitDate,
                timezone: "-0400",
            },
            commitMsg: commitMsg ?? "",
            id: "",
            parentIds: [currentCommit],
            tree: rootTree.hash,
        });

        // Write the commit
        // old parent: 51a16ca9dbd65cc44567ec4d8373ac7be58c72db
        await GitObject.writeObject(commit);
        console.log(commit.hash.length);
        await GitRef.updateRef(currentBranch, commit.hash);
    }

    static generateCommit(commitData: GitCommitRaw): GitObjectData {
        const parents = commitData.parentIds
            .map((parent) => `parent ${parent}`)
            .join("\n");
        const data = `tree ${commitData.tree}\n${parents}\nauthor ${
            commitData.author.nameAndEmail
        } ${Math.floor(commitData.author.date.getTime() / 1000)} ${
            commitData.author.timezone
        }\ncommitter ${commitData.author.nameAndEmail} ${Math.floor(
            commitData.author.date.getTime() / 1000
        )} ${commitData.author.timezone}\n\n${commitData.commitMsg}\n`;

        return {
            type: "commit",
            hash: HashUtil.getHash(`commit ${data.length}\0${data}`),
            data: data,
            size: data.length,
        };
    }

    // TODO: make this not a performance nightmare
    static async indexToTree(
        index: GitIndexDataRow[]
    ): Promise<Record<string, GitObjectData>> {
        const indicesByDirectory = _.groupBy(index, (i) =>
            path.dirname(i.path)
        );
        const indexBlobsByPath = _.keyBy(
            index.map<TreeData>((idx) => ({
                hash: idx.id,
                mode: idx.mode,
                path: idx.path,
                type: "blob",
            })),
            (b) => b.path
        );
        const allSubPaths = _.uniq(
            Object.keys(indicesByDirectory).flatMap((dir) => {
                const results: string[] = [dir];
                while (dir !== ".") {
                    const sub = path.dirname(dir);

                    results.push(sub);
                    dir = sub;
                }

                return results;
            })
        );

        const reverseSortedDirectories = _.sortBy(allSubPaths).reverse();
        const results: Record<string, GitObjectData> = {};

        for (const stub of reverseSortedDirectories) {
            const allIndicesInStub = indicesByDirectory[stub];
            const indexObjects = allIndicesInStub.map(
                (i) => indexBlobsByPath[i.path]
            );

            const allDirsInStub = allSubPaths.filter(
                (f) => path.dirname(f) === stub && results[f]
            );

            const baseData: GitObjectData = {
                type: "tree",
                data: [
                    ...allDirsInStub.map<TreeData>((dir) => ({
                        hash: results[dir].hash,
                        type: "tree",
                        mode: 0,
                        path: dir,
                    })),
                    ...indexObjects,
                ],
                hash: "",
                size: -1,
            };

            const [buffer, contentSize] =
                GitObject.treeObjectToCompressedBuffer(baseData);

            results[stub] = {
                ...baseData,
                hash: HashUtil.getHash(buffer),
                size: contentSize,
            };
        }

        return results;
    }
}
