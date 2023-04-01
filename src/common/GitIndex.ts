import fs from "fs-extra";
import _ from "lodash";
import { CommitWalker } from "../walking/CommitWalker";
import { GitDirectory } from "./GitDirectory";
import { GitObject, GitObjectData } from "./GitObject";
import { HashUtil } from "./Hash.util";

type IndexTimeStamp = {
    seconds: number;
    nanosecondFraction: number;
};

export type GitIndexDataRow = {
    metadataChangedAt: IndexTimeStamp;
    dataChangedAt: IndexTimeStamp;
    device: number;
    inodeNumber: number;
    mode: number;
    userIdentifier: number;
    groupIdentifier: number;
    fileSize: number;
    id: string;
    flags: number;
    path: string;
};

// https://github.com/git/git/blob/867b1c1bf68363bcfd17667d6d4b9031fa6a1300/Documentation/technical/index-format.txt#L38
export class GitIndex {
    static async stageFile(fileName: string) {
        const [indexRow, objectData] = await this.readFileAsIndexDataRow(
            fileName
        );

        // Write the object if a new object was created
        await GitObject.writeObject(objectData);

        // And now we rewrite the index
        const oldIndexRows = await this.readIndex();
        const oldIndexRowsWithoutThisObject = oldIndexRows.filter(
            (idx) => idx.path !== indexRow.path
        );
        await this.writeIndex([...oldIndexRowsWithoutThisObject, indexRow]);
    }

    // TOOD: clean clean clean clean
    static async readModifiedFileAndGenerateOriginalIndexDataRow(
        fileName: string,
        object: GitObjectData
    ): Promise<GitIndexDataRow> {
        const stat = await fs.stat(fileName);
        const relativePath = await GitDirectory.getProjectRelativePath(
            fileName
        );

        return {
            device: stat.dev,
            fileSize: object.size,
            inodeNumber: 0,
            groupIdentifier: 0,
            userIdentifier: 0,
            dataChangedAt: {
                seconds: 0,
                nanosecondFraction: 0,
            },
            metadataChangedAt: {
                seconds: 0,
                nanosecondFraction: 0,
            },
            mode: stat.mode,
            path: relativePath,
            id: object.hash,
            flags: relativePath.length > 0xfff ? 0xfff : relativePath.length,
        };
    }

    // TOOD: clean clean clean clean
    static async readFileAsIndexDataRow(
        fileName: string
    ): Promise<[GitIndexDataRow, GitObjectData]> {
        const stat = await fs.stat(fileName);
        const object = await GitObject.createObjectFromDisk(fileName);
        const relativePath = await GitDirectory.getProjectRelativePath(
            fileName
        );

        return [
            {
                device: stat.dev,
                fileSize: stat.size,
                inodeNumber: stat.ino,
                groupIdentifier: stat.gid,
                userIdentifier: stat.uid,
                dataChangedAt: {
                    seconds: Math.floor(stat.mtimeMs / 1000),
                    nanosecondFraction: Math.floor(
                        (stat.mtimeMs -
                            Math.floor(stat.mtimeMs / 1000) * 1000) *
                            1000000
                    ),
                },
                metadataChangedAt: {
                    seconds: Math.floor(stat.ctimeMs / 1000),
                    nanosecondFraction: Math.floor(
                        (stat.ctimeMs -
                            Math.floor(stat.ctimeMs / 1000) * 1000) *
                            1000000
                    ),
                },
                mode: stat.mode,
                path: relativePath,
                id: object.hash,
                flags:
                    relativePath.length > 0xfff ? 0xfff : relativePath.length,
            },
            object,
        ];
    }

    static async writeIndex(rows: GitIndexDataRow[]) {
        const indexPath = await GitDirectory.getIndexPath();

        const header = Buffer.alloc(12);
        header.write("DIRC", 0);
        // Version 2
        header.writeUInt32BE(2, 4);
        // Num entries
        header.writeUInt32BE(rows.length, 8);

        // TODO: make this not awful
        let body = Buffer.alloc(0);
        const sortedRows = _.sortBy(rows, (r) => r.path);
        for (let i = 0; i < sortedRows.length; i++) {
            const entry = sortedRows[i];
            const baseSize = 62 + entry.path.length + 1;
            const entryBuffer = Buffer.alloc(Math.ceil((baseSize + 1) / 8) * 8);
            entryBuffer.writeUInt32BE(entry.metadataChangedAt.seconds, 0);
            entryBuffer.writeUInt32BE(
                entry.metadataChangedAt.nanosecondFraction,
                4
            );
            entryBuffer.writeUInt32BE(entry.dataChangedAt.seconds, 8);
            entryBuffer.writeUInt32BE(
                entry.dataChangedAt.nanosecondFraction,
                12
            );
            entryBuffer.writeUInt32BE(entry.device, 16);
            entryBuffer.writeUInt32BE(entry.inodeNumber, 20);
            entryBuffer.writeUInt32BE(entry.mode, 24);
            entryBuffer.writeUInt32BE(entry.userIdentifier, 28);
            entryBuffer.writeUInt32BE(entry.groupIdentifier, 32);
            entryBuffer.writeUInt32BE(entry.fileSize, 36);

            const oid = Buffer.from(entry.id, "hex");
            oid.copy(entryBuffer, 40);

            entryBuffer.writeUInt16BE(entry.flags, 60);

            const nameBuffer = Buffer.from(entry.path, "ascii");
            nameBuffer.copy(entryBuffer, 62);

            body = Buffer.from([...body, ...entryBuffer]);
        }

        const headerAndBody = Buffer.from([...header, ...body]);
        const finalBuffer = Buffer.from([
            ...headerAndBody,
            ...Buffer.from(HashUtil.getHash(headerAndBody), "hex"),
        ]);

        return fs.writeFile(indexPath, finalBuffer);
    }

    static async readIndex(): Promise<GitIndexDataRow[]> {
        const indexPath = await GitDirectory.getIndexPath();
        const indexFile = await fs.readFile(indexPath);

        const headerString = indexFile.subarray(0, 4).toString();
        if (headerString !== "DIRC") {
            throw new Error(
                `Expected Index header to begin with 'DIRC' but received ${headerString}`
            );
        }

        const version = indexFile.readUInt32BE(4);
        if (version !== 2) {
            throw new Error(`Expected Index version 2 but found ${version}`);
        }

        const numEntries = indexFile.readUInt32BE(8);
        const rows: GitIndexDataRow[] = [];
        const subBuffer = indexFile.subarray(12, indexFile.length - 20);
        let currentPosition: number = 0;
        for (let i = 0; i < numEntries; i++) {
            const startingPosition = currentPosition;
            const ctime_seconds = subBuffer.readUint32BE(currentPosition);
            currentPosition += 4;
            const ctime_ns = subBuffer.readUint32BE(currentPosition);
            currentPosition += 4;
            const mtime_seconds = subBuffer.readUint32BE(currentPosition);
            currentPosition += 4;
            const mtime_ns = subBuffer.readUint32BE(currentPosition);
            currentPosition += 4;

            const dev = subBuffer.readUint32BE(currentPosition);
            currentPosition += 4;

            const ino = subBuffer.readUint32BE(currentPosition);
            currentPosition += 4;

            const mode = subBuffer.readUint32BE(currentPosition);
            currentPosition += 4;

            const uid = subBuffer.readUint32BE(currentPosition);
            currentPosition += 4;

            const gid = subBuffer.readUint32BE(currentPosition);
            currentPosition += 4;

            const file_size = subBuffer.readUint32BE(currentPosition);
            currentPosition += 4;

            const oid = subBuffer
                .subarray(currentPosition, currentPosition + 20)
                .toString("hex");
            currentPosition += 20;

            const flags = subBuffer.readUint16BE(currentPosition);
            currentPosition += 2;

            // 1 NUL byte to pad the entry to a multiple of eight bytes while keeping the name NUL-terminated.
            const firstNullByteIndex = subBuffer.indexOf("\0", currentPosition);
            const rawSize = firstNullByteIndex - startingPosition + 1;
            const roundedSize = Math.ceil(rawSize / 8.0) * 8;
            const file_path = subBuffer
                .subarray(currentPosition, firstNullByteIndex)
                .toString()
                .replace(/\0/gi, "")
                .trim();
            currentPosition = startingPosition + roundedSize;

            rows.push({
                flags,
                mode,
                device: dev,
                inodeNumber: ino,
                userIdentifier: uid,
                groupIdentifier: gid,
                fileSize: file_size,
                path: file_path,
                metadataChangedAt: {
                    seconds: ctime_seconds,
                    nanosecondFraction: ctime_ns,
                },
                dataChangedAt: {
                    seconds: mtime_seconds,
                    nanosecondFraction: mtime_ns,
                },
                id: oid,
            });
        }

        const expectedChecksum = indexFile
            .subarray(indexFile.length - 20)
            .toString("hex");
        const realChecksum = HashUtil.getHash(
            indexFile.subarray(0, indexFile.length - 20)
        );

        if (realChecksum !== expectedChecksum) {
            throw new Error(
                `Expected index file to have checksum ${expectedChecksum} but had ${realChecksum}`
            );
        }

        return rows;
    }

    static async resetIndexToTree(
        tree: GitObjectData,
        specificFiles?: string[]
    ) {
        if (tree.type !== "tree") {
            throw new Error(
                "Attempting to reset index but provided a non-tree object"
            );
        }

        const indexRows = await this.readIndex();
        const regeneratedRows = await this.generateIndexRowsFromTree(
            tree,
            specificFiles
        );
        const newRows = [
            ...indexRows.filter(
                (r) => !regeneratedRows.some((o) => o.path === r.path)
            ),
            ...regeneratedRows,
        ];

        await this.writeIndex(newRows);
    }

    static async generateIndexRowsFromTree(
        tree: GitObjectData,
        specificFiles?: string[]
    ): Promise<GitIndexDataRow[]> {
        if (tree.type !== "tree") {
            throw new Error(`Attempting to restore tree with non-tree object`);
        }

        const rows: GitIndexDataRow[] = [];

        for (const node of tree.data) {
            const childObject = await CommitWalker.findObject(node.hash);

            if (childObject.type === "tree") {
                const subResults = await this.generateIndexRowsFromTree(
                    childObject,
                    specificFiles
                );
                rows.push(...subResults);
                continue;
            }

            // Ensure this node is one of what we are attempting to generate
            // TODO: optimize walking based on this subset
            if (specificFiles && !specificFiles.includes(node.path)) {
                continue;
            }

            const row =
                await this.readModifiedFileAndGenerateOriginalIndexDataRow(
                    node.path,
                    childObject
                );
            rows.push(row);
        }

        return rows;
    }
}
