import { program } from "commander";
import { GitObject } from "./common/GitObject";
import { GitRef } from "./common/GitRef";

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
    .command("checkout")
    .argument("<branchname>")
    .action(async (branchName, flags) => {
        const refPath = `refs/heads/${branchName}`;
        await GitRef.updateCurrentRef(refPath);
    });

program.parse();
