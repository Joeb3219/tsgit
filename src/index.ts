import { program } from "commander";
import { GitObject } from "./common/GitObject";

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

program.parse();
