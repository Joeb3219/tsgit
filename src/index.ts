import chalk from "chalk";
import { program } from "commander";
import _ from "lodash";
import moment from "moment";
import { GitDirectory } from "./common/GitDirectory";
import { GitIndex } from "./common/GitIndex";
import { GitObject } from "./common/GitObject";
import { GitPack } from "./common/GitPack";
import { GitRef } from "./common/GitRef";
import { CommitWalker, GitCommit } from "./walking/CommitWalker";

program
    .command("cat-file")
    .option("-t", "show object type")
    .option("-s", `show object size`)
    .option("-e", `exit with zero when there's no error`)
    .option("-p", `pretty-print object's content`)
    .argument("<object>")
    .action(async (hash, flags) => {
        const object = await GitObject.readObjectFromDisk(hash);

        if (!flags.t && !flags.p && !flags.s && !flags.e) {
            throw new Error("Please specify output mode");
        }

        if (flags.t) {
            console.log(object.type);
            return;
        }

        if (flags.p) {
            if (object.type === "tree") {
                object.data.forEach((datum) => {
                    console.log(
                        `${datum.mode.toString().padStart(6, "0")} ${
                            datum.type
                        } ${datum.hash}\t${datum.path}`
                    );
                });
            } else {
                console.log(object.data);
            }
            return;
        }

        if (flags.s) {
            console.log(object.size);
            return;
        }

        if (flags.e) {
            return;
        }
    });

program
    .command("hash-object")
    .option("-w", "Actually write the object into the object database.")
    .argument("<path>")
    .action(async (path, flags) => {
        const object = await GitObject.createObjectFromDisk(path);
        console.log(object.hash);

        if (flags.w) {
            await GitObject.writeObject(object);
        }
    });

program
    .command("update-ref")
    .option("-d", "delete the reference")
    .argument("<refname>")
    .argument("[newvalue]")
    .action(async (refName, newValue, flags) => {
        if (!flags.d && !newValue) {
            throw new Error("Missing ref value");
        }

        if (flags.d) {
            await GitRef.deleteRef(refName);
            return;
        }

        await GitRef.updateRef(refName, newValue);
    });

program
    .command("branch")
    .argument("<branchname>")
    .action(async (branchName, flags) => {
        const refPath = `refs/heads/${branchName}`;
        const currentRef = await GitRef.getCurrentRef();
        const currentRefValue = await GitRef.getRef(currentRef);
        await GitRef.updateRef(refPath, currentRefValue);
    });

program
    .command("symbolic-ref")
    .argument("<symbolic-ref-name>")
    .argument("[new-ref-name]")
    .action(async (symbolicRefName, newRefName) => {
        if (symbolicRefName !== "HEAD") {
            throw new Error(
                `Unimplemented symbolic-ref-name ${symbolicRefName}`
            );
        }

        if (newRefName) {
            await GitRef.updateCurrentRef(newRefName);
        }

        console.log(await GitRef.getCurrentRef());
    });

program
    .command("update-ref")
    .argument("<ref>")
    .argument("<new-value>")
    .action(async (ref, newValue) => {
        await GitRef.updateRef(ref, newValue);
    });

program
    .command("checkout")
    .argument("<branchname>")
    .action(async (branchName, flags) => {
        const refPath = `refs/heads/${branchName}`;
        await GitRef.updateCurrentRef(refPath);
    });

program
    .command("verify-pack")
    .option("-v")
    .argument("<pack-path>")
    .action(async (packPath, flags) => {
        const pack = await GitPack.readGitPack(
            packPath,
            packPath.replace(".pack", ".idx")
        );

        const entriesByChainLength = _.groupBy(pack.entries, (e) =>
            "depth" in e ? e.depth : 0
        );

        pack.entries.forEach((entry) => {
            console.log(
                `${entry.id} ${
                    "rootType" in entry ? entry.rootType : entry.type
                } ${entry.size} ${entry.sizeInPack} ${entry.offset} ${
                    entry.type === "ofs_delta" || entry.type === "ref_delta"
                        ? `${entry.depth} ${entry.parent.id}`
                        : ``
                }`
            );
        });
        console.log(
            `non delta: ${
                pack.entries.filter(
                    (entry) =>
                        entry.type !== "ofs_delta" && entry.type !== "ref_delta"
                ).length
            } objects`
        );
        Object.entries(entriesByChainLength)
            .filter((e) => e[0] !== "0")
            .forEach(([chainLength, objects]) => {
                console.log(
                    `chain length = ${chainLength}: ${objects.length} objects`
                );
            });
    });

program.command("log").action(async () => {
    let candidateCommits: GitCommit[] = [
        await CommitWalker.findCurrentCommitAndAncestors(),
    ];
    const branchRefs = await GitRef.getAllBranchRefs(true);
    const headRef = await GitRef.getCurrentRef();
    while (candidateCommits.length) {
        const commit = _.maxBy(candidateCommits, (c) => c.author.date);
        candidateCommits = candidateCommits.filter((c) => c.id !== commit?.id);

        // Should never happen
        if (!commit) {
            return;
        }

        const commitBranchHeads = Object.entries(branchRefs).filter(
            (b) => b[1] === commit.id
        );
        const branchString = commitBranchHeads
            .map((h) => {
                const refName = h[0];
                const branchName = GitRef.refToBranchName(refName);
                const isHead = refName === headRef;

                if (isHead) {
                    return `${chalk.blueBright("HEAD ->")} ${chalk.greenBright(
                        branchName
                    )}`;
                }

                if (refName.startsWith("refs/remotes")) {
                    return `${chalk.redBright(branchName)}`;
                }

                return `${chalk.greenBright(branchName)}`;
            })
            .join(", ");

        console.log(
            chalk.yellowBright(
                `commit ${commit.id} ${branchString ? `(${branchString})` : ""}`
            )
        );
        console.log(chalk.whiteBright(`Author: ${commit.author.nameAndEmail}`));
        console.log(
            chalk.whiteBright(
                `Date: ${moment(commit.author.date)
                    .utcOffset(commit.author.timezone)
                    .toLocaleString()}`
            )
        );
        console.log(chalk.whiteBright(`\n\t${commit.commitMsg}\n`));

        candidateCommits.push(...commit.parents);
    }
});

program
    .command("reset")
    .option("--hard")
    .option("--mixed")
    .argument("[path]")
    .action(async (path, flags) => {
        const currentTree = await CommitWalker.getCurrentTree();

        if (flags.hard) {
            await CommitWalker.restoreTree(currentTree);
            return;
        }

        // Default: reset from index but don't full restore the tree
        // TODO: support globs
        await GitIndex.resetIndexToTree(currentTree, path ? [path] : undefined);
    });

program
    .command("add")
    .argument("<path>")
    .action(async (path) => {
        await GitIndex.stageFile(path);
    });

program.command("index").action(async () => {
    const result = await GitIndex.readIndex();
    console.log(result);
});

program.command("status").action(async () => {
    const index = await GitIndex.readIndex();
    const currentTree = await CommitWalker.getCurrentTree();
    const flattenedTree = await CommitWalker.flattenTree(currentTree);
    const flattedTreeByPath = _.keyBy(flattenedTree, (t) => t.path);
    const currentRef = await GitRef.getCurrentRef();
    const currentBranchName = GitRef.refToBranchName(currentRef);
    const indexByPath = _.keyBy(index, (i) => i.path);

    const stagedFiles = index.filter((row) => {
        const matchedTreeNode = flattedTreeByPath[row.path];

        if (!matchedTreeNode) {
            return true;
        }

        // If the IDs match, the contents of the files are the same.
        return matchedTreeNode.hash !== row.id;
    });

    const workingDirectory = await GitDirectory.walkDirectory();
    const workingDirectoryByPath = _.keyBy(workingDirectory, (w) => w.path);
    const untrackedFiles = workingDirectory.filter((untracked) => {
        const indexEntry = indexByPath[untracked.path];

        // If it's in the index, we clearly have tracked it
        return !indexEntry;
    });

    const allIndexAndWorkingPaths = _.uniq([
        ...index.map((i) => i.path),
        ...workingDirectory.map((w) => w.path),
    ]);
    const changesNotStagedFiles = _.compact(
        allIndexAndWorkingPaths.map<[string, "deleted" | "modified"] | null>(
            (path) => {
                const wdEntry = workingDirectoryByPath[path];
                const indexEntry = indexByPath[path];

                // It's in the index, but no longer is in the working directory
                // Thus, it's been deleted
                if (!wdEntry && !!indexEntry) {
                    return [path, "deleted"];
                }

                // If it's in WD but not entry, it's untracked -- this doesn't count as not staged.
                if (!!wdEntry && !indexEntry) {
                    return null;
                }

                // We are modified if either the metadata or data of the working directory is more recent than the index entry.
                if (
                    GitIndex.isTimeStampGreaterThanEqual(
                        wdEntry.metadataChangedAt,
                        indexEntry.metadataChangedAt
                    ) ||
                    GitIndex.isTimeStampGreaterThanEqual(
                        wdEntry.dataChangedAt,
                        indexEntry.metadataChangedAt
                    )
                ) {
                    return [path, "modified"];
                }

                return null;
            }
        )
    );

    console.log(`On branch ${currentBranchName}`);
    if (stagedFiles.length) {
        console.log(`Changes to be committed:`);
        console.log(`    (use "git restore --staged <file>..." to unstage)`);
        stagedFiles.forEach((file) => {
            console.log(
                chalk.greenBright(
                    `\t${
                        !!flattedTreeByPath[file.path] ? "modified" : "new file"
                    }:  ${file.path}`
                )
            );
        });
    }

    if (changesNotStagedFiles.length) {
        console.log(`Changes not staged for commit:`);
        console.log(
            `    (use "git add/rm <file>..." to update what will be committed)`
        );
        console.log(
            `    (use "git restore <file>..." to discard changes in working directory)`
        );
        changesNotStagedFiles.forEach((file) => {
            console.log(chalk.redBright(`\t${file[1]}:  ${file[0]}`));
        });
    }

    if (untrackedFiles.length) {
        console.log(`Untracked files:`);
        console.log(
            `    (use "git add <file>..." to include in what will be committed)`
        );
        untrackedFiles.forEach((file) => {
            console.log(chalk.redBright(`\t${file.path}`));
        });
    }

    if (stagedFiles.length === 0) {
        console.log(
            `no changes added to commit (use "git add" and/or "git commit -a")`
        );
    }
});

program.parse();
