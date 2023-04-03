import fs from "fs-extra";
import _ from "lodash";
import path from "path";
import { CompressionUtil } from "./Compression.util";
import { GitDirectory } from "./GitDirectory";
import { HashUtil } from "./Hash.util";

export type TreeData = {
    mode: number;
    hash: string;
    path: string;
    type: "tree" | "blob" | "commit";
};

export type GitObjectData =
    | {
          type: "blob" | "commit";
          data: string;
          hash: string;
          size: number;
      }
    | {
          type: "tree";
          data: TreeData[];
          hash: string;
          size: number;
      };

export class GitObject {
    static async readObjectFromContents(
        str: string | Buffer
    ): Promise<GitObjectData> {
        const decompressed = await CompressionUtil.decompress(str);
        return this.readDecompressedObjectFromContents(decompressed);
    }

    static treeObjectToCompressedBuffer(
        object: GitObjectData
    ): [Buffer, number] {
        if (object.type !== "tree") {
            throw new Error(
                `Attempted to convert tree-object to buffer but given non-tree object`
            );
        }

        // TODO: stop having two very similar implementations of this
        const sortedData = _.sortBy(object.data, (datum) => datum.path);
        const treeDataBuffer = sortedData.reduce<Buffer>((state, datum) => {
            const newRow = Buffer.from([
                ...Buffer.from(
                    `${
                        datum.type === "commit"
                            ? "160000"
                            : datum.type === "tree"
                            ? "040000"
                            : "100644"
                    } ${datum.path}\0`,
                    "utf-8"
                ),
                ...Buffer.from(datum.hash, "hex"),
            ]);
            return Buffer.from([...state, ...newRow]);
        }, Buffer.alloc(0));

        const headerString = `tree ${treeDataBuffer.length}\0`;

        return [
            Buffer.from([...Buffer.from(headerString), ...treeDataBuffer]),
            treeDataBuffer.length,
        ];
    }

    static async readDecompressedObjectFromContents(
        decompressed: Buffer
    ): Promise<GitObjectData> {
        const [header, ...dataParts] = decompressed.toString().split("\0");
        const data = dataParts.join("\0");
        const [type, contentSizeString] = header.split(" ");

        if (type !== "blob" && type !== "commit" && type !== "tree") {
            throw new Error(
                `Expected to receive object type of blob, commit, or tree, but received ${type}`
            );
        }

        const contentSize = parseInt(contentSizeString, 10);
        if (type === "blob" && contentSize !== data.length) {
            throw new Error(
                `Expected to read content of length ${contentSize}, but found content of length ${data.length}`
            );
        }

        if (type === "tree") {
            const buffer = decompressed.subarray(
                decompressed.indexOf("\0") + 1
            );
            let currentPosition: number = 0;
            const parsedResults: TreeData[] = [];
            while (currentPosition < buffer.length) {
                const firstSpace = buffer.indexOf(" ", currentPosition);
                const firstNull = buffer.indexOf("\0", firstSpace);

                if (firstSpace === -1 || firstNull === -1) {
                    throw new Error("Malformed tree object");
                }

                const modeStr = buffer
                    .subarray(currentPosition, firstSpace)
                    .toString("utf-8")
                    .trim();

                const pathStr = buffer
                    .subarray(firstSpace + 1, firstNull)
                    .toString("utf-8")
                    .trim();

                const hash = buffer
                    .subarray(firstNull + 1, firstNull + 21)
                    .toString("hex");

                parsedResults.push({
                    hash,
                    mode: this.parseModeString(modeStr),
                    path: pathStr,
                    type:
                        modeStr === "160000"
                            ? "commit"
                            : modeStr === "040000"
                            ? "tree"
                            : "blob",
                });

                currentPosition = firstNull + 21;
            }

            return {
                type,
                hash: HashUtil.getHash(decompressed),
                size: contentSize,
                data: parsedResults,
            };
        }

        return {
            type,
            data,
            hash: HashUtil.getHash(decompressed),
            size: contentSize,
        };
    }

    static parseModeString(str: string): number {
        // Directory/Tree
        if (str.match(/^0?4.*/)) {
            return 40000;
        }

        // Non-executable file
        if (str.match(/^1006.*/)) {
            return 100644;
        }

        // Executable file
        if (str.match(/^1007.*/)) {
            return 100755;
        }

        // Symlink
        if (str.match(/^120.*/)) {
            return 120000;
        }

        // Commit
        if (str.match(/^160.*/)) {
            return 160000;
        }

        throw new Error(`Unknown mode string ${str}`);
    }

    static async readObjectFromDisk(hash: string): Promise<GitObjectData> {
        const path = await GitDirectory.getObjectPath(hash);
        const file = await fs.readFile(path);
        const object = await this.readObjectFromContents(file);

        if (object.hash !== hash) {
            throw new Error(
                `Object stored with hash ${hash} is invalid (found hash ${object.hash})`
            );
        }

        return object;
    }

    static getObjectPayload(object: GitObjectData): string | Buffer {
        const header = `${object.type} ${object.size}\0`;
        if (object.type === "tree") {
            const treeData = Buffer.alloc(object.size);

            // TODO: stop having two very similar implementations of this
            let currentPosition: number = 0;
            const sortedData = _.sortBy(object.data, (datum) => datum.path);
            for (const datum of sortedData) {
                const newRow = Buffer.from([
                    ...Buffer.from(
                        `${
                            datum.type === "commit"
                                ? "160000"
                                : datum.type === "tree"
                                ? "040000"
                                : "100644"
                        } ${datum.path}\0`,
                        "utf-8"
                    ),
                    ...Buffer.from(datum.hash, "hex"),
                ]);
                newRow.copy(treeData, currentPosition);
                currentPosition += newRow.length;
            }

            return Buffer.from([...Buffer.from(header), ...treeData]);
        }

        return `${header}${object.data}`;
    }

    static async createObjectFromDisk(path: string): Promise<GitObjectData> {
        const file = await fs.readFile(path);
        const data = file.toString();

        const fullObject = `blob ${data.length}\0${data}`;

        return {
            data,
            size: data.length,
            type: "blob",
            hash: HashUtil.getHash(fullObject),
        };
    }

    static async writeObject(object: GitObjectData) {
        const objectPath = await GitDirectory.getObjectPath(object.hash);

        // TODO: this should not be possible
        if (await fs.exists(objectPath)) {
            await fs.remove(objectPath);
        }

        const directory = path.dirname(objectPath);
        await fs.mkdirp(directory);

        const payload = this.getObjectPayload(object);
        const compressedPayload = await CompressionUtil.compress(payload);

        return fs.writeFile(objectPath, compressedPayload, { mode: 444 });
    }
}
