import fs from "fs-extra";
import { CompressionUtil } from "./Compression.util";
import { GitDirectory } from "./GitDirectory";
import { HashUtil } from "./Hash.util";
import { StringUtil } from "./String.util";

export type GitObjectData =
    | {
          type: "blob" | "commit";
          data: string;
          hash: string;
          size: number;
      }
    | {
          type: "tree";
          data: {
              mode: number;
              hash: string;
              path: string;
          }[];
          hash: string;
          size: number;
      };

export class GitObject {
    static async readObjectFromContents(
        str: string | Buffer
    ): Promise<GitObjectData> {
        const decompressed = await CompressionUtil.decompress(str);

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
            const nullPositions = StringUtil.findAllIndices(data, "\0");
            const splits = StringUtil.splitStringAtPositions(
                data,
                nullPositions.map((pos) => pos + 21)
            );

            return {
                type,
                hash: HashUtil.getHash(decompressed),
                size: contentSize,
                data: splits.map((datum) => {
                    const [leftHalf, shaHash] = datum.split("\0");
                    const [mode, ...pathParts] = leftHalf.split(" ");
                    const pathString = pathParts.join(" ");

                    return {
                        mode: parseInt(mode, 10),
                        path: pathString,
                        hash: Buffer.from(shaHash, "binary").toString("hex"),
                    };
                }),
            };
        }

        return {
            type,
            data,
            hash: HashUtil.getHash(decompressed),
            size: contentSize,
        };
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
}
