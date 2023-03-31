import fs from "fs-extra";
import _ from "lodash";
import { CompressionUtil } from "./Compression.util";
import { GitObject, GitObjectData } from "./GitObject";

type PackFile = {
    version: 2 | 3;
    numEntries: number;
    entries: PackFileEntry[];
};

type PackFileEntryNormal = {
    type: "commit" | "tree" | "blob" | "tag";
    rawData: Buffer;
    object: GitObjectData;
    size: number;
    sizeInPack: number;
    offset: number;
    id: string;
};

type PackFileEntryDeltafied = {
    type: "ofs_delta" | "ref_delta";
    rawData: Buffer;
    size: number;
    sizeInPack: number;
    offset: number;
    parent: PackFileEntry;
    depth: number;
    rootType: "commit" | "tree" | "blob" | "tag";
    id: string;
};

export type PackFileEntry = PackFileEntryDeltafied | PackFileEntryNormal;

type PackFileEntryType = PackFileEntry["type"];

export class GitPack {
    // TOOD: cleaner implementation
    static readVariableLengthBytes(
        buffer: Buffer,
        currentPosition: number
    ): Buffer {
        let outputBuffer = Buffer.alloc(0);

        while (currentPosition < buffer.length - 1) {
            const newByte = buffer.readUInt8(currentPosition);
            currentPosition++;

            outputBuffer = Buffer.from([...outputBuffer, newByte]);

            // The first bit is 0, so we've finished reading bytes.
            if ((newByte & 0b1000_0000) === 0b0000_0000) {
                break;
            }
        }

        return outputBuffer;
    }

    static parsePackFileEntryType(num: number): PackFileEntryType {
        switch (num) {
            case 0b001:
                return "commit";
            case 0b010:
                return "tree";
            case 0b011:
                return "blob";
            case 0b100:
                return "tag";
            case 0b110:
                return "ofs_delta";
            case 0b111:
                return "ref_delta";
        }

        throw new Error(`Unknown pack file entry type ${num}`);
    }

    // TODO: need to handle big big numbers (> 2^32)
    static variableLengthTypeBytesToLengthNumber(buffer: Buffer): number {
        if (buffer.length === 0) {
            return 0;
        }

        // Since our numbers are little-endian, we must shift all new bytes to the left of our current value
        let shift = 4;
        return buffer.subarray(1).reduce((state, byte) => {
            const result = state | ((byte & 0b0111_1111) << shift);
            shift += 7;
            return result;
        }, buffer[0] & 0b0000_1111);
    }

    // TODO: need to handle big big numbers (> 2^32)
    static variableLengthBytesToOffset(buffer: Buffer): number {
        if (buffer.length === 0) {
            return 0;
        }

        return buffer.reduce(
            (state, byte) => ((state + 1) << 7) | (byte & 0b0111_1111),
            -1
        );
    }

    static async readGitIndex(
        indexPath: string
    ): Promise<Record<string, number>> {
        const buffer = await fs.readFile(indexPath);

        if (!buffer.subarray(0, 4).equals(Buffer.from([255, 116, 79, 99]))) {
            throw new Error("Invalid Pack-file index header");
        }

        // The fanout table starts at byte 4, consisting of 256 4-byte values.
        // fanout entry i is the count of objects with a first byte <= i
        // thus, byte 1028, the last (255th) entry, will be the total count of all objects.
        const fanoutTableStart = 4;
        const numObjects = buffer.readUInt32BE(fanoutTableStart + 256 * 4);

        // Immediately following the fanout table at byte 1028, we have numObjects 20-byte values, the Object IDs.
        const objectIdsStart = fanoutTableStart + 257 * 4;
        const objectIds = _.range(
            objectIdsStart,
            objectIdsStart + numObjects * 20,
            20
        ).map((offset) => buffer.subarray(offset, offset + 20));

        const crcsStart = objectIdsStart + numObjects * 20;
        const crcs = _.range(crcsStart, crcsStart + numObjects * 4, 4).map(
            (offset) => buffer.readUInt32BE(offset)
        );

        const offsetsStart = crcsStart + numObjects * 4;
        const offsets = _.range(
            offsetsStart,
            offsetsStart + numObjects * 4,
            4
        ).map((offset) => buffer.readUInt32BE(offset));

        const potentialOverflowOffset = offsetsStart + (numObjects + 4);

        // We don't yet support large pack files, which will actually have more bytes spilled to yet another layer.
        if (potentialOverflowOffset + numObjects * 8 + 40 <= buffer.length) {
            throw new Error("Packfile is >2 GB and not yet supported");
        }

        return objectIds.reduce((state, objectId, idx) => {
            const offset = offsets[idx];
            const crc = crcs[idx];

            if (!offset || !crc) {
                throw new Error(
                    `Packfile index entry ${idx} missing crc or offset`
                );
            }

            // TODO: validate the CRC

            return {
                ...state,
                [objectId.toString("hex")]: offset,
            };
        }, {});

        // TODO: validate checksum
    }

    // https://shafiul.github.io/gitbook/7_the_packfile.html
    // https://codewords.recurse.com/issues/three/unpacking-git-packfiles
    // TODO: use the index file
    static async readGitPack(
        packPath: string,
        indexPath: string
    ): Promise<PackFile> {
        const buffer = await fs.readFile(packPath);
        const index = await this.readGitIndex(indexPath);
        const idsByOffset = Object.entries(index).reduce<
            Record<number, string>
        >((state, entry) => ({ ...state, [entry[1]]: entry[0] }), {});
        const sortedOffsets = _.sortBy(Object.values(index));

        if (buffer.subarray(0, 4).toString() !== "PACK") {
            throw new Error("Invalid Pack-file header string");
        }

        const version = buffer.readInt32BE(4);

        if (version !== 2) {
            throw new Error(
                `Expected Pack-file version 2 but received ${version}`
            );
        }

        const numEntries = buffer.readInt32BE(8);

        const entries: PackFileEntry[] = [];
        for (let i = 0; i < numEntries; i++) {
            const startingPosition: number = sortedOffsets[i] ?? 12;
            const id = idsByOffset[startingPosition];
            const nextEntryOffset = sortedOffsets[i + 1] ?? undefined;
            const sizeInPack =
                (nextEntryOffset ?? buffer.length - 40) - startingPosition;
            let currentPosition: number = startingPosition;

            if (!id) {
                throw new Error("Failed to find Object ID for PACK-file entry");
            }

            const header = this.readVariableLengthBytes(
                buffer,
                currentPosition
            );

            if (header.length === 0) {
                throw new Error(
                    "Encountered PACK-file entry with header of 0 bytes"
                );
            }

            currentPosition += header.length;
            const firstByte = header[0];
            const type = this.parsePackFileEntryType(
                (firstByte & 0b0111_0000) >> 4
            );
            const entrySize =
                this.variableLengthTypeBytesToLengthNumber(header);

            switch (type) {
                case "blob":
                case "commit":
                case "tag":
                case "tree": {
                    // Now we decompress the data
                    const nonMutatedData = await CompressionUtil.decompress(
                        buffer.subarray(currentPosition, nextEntryOffset)
                    );

                    const data = Buffer.from([
                        ...Buffer.from(`${type} ${entrySize}\0`, "ascii"),
                        ...nonMutatedData,
                    ]);
                    const convertedObject =
                        await GitObject.readDecompressedObjectFromContents(
                            data
                        );
                    entries.push({
                        type,
                        rawData: nonMutatedData,
                        object: convertedObject,
                        id,
                        sizeInPack,
                        size: entrySize,
                        offset: startingPosition,
                    });
                    continue;
                }
                case "ref_delta":
                    throw new Error("foo");
                case "ofs_delta": {
                    const offsetBuffer = this.readVariableLengthBytes(
                        buffer,
                        currentPosition
                    );
                    const offset =
                        this.variableLengthBytesToOffset(offsetBuffer);
                    currentPosition += offsetBuffer.length;
                    const foundObject = entries.find(
                        (e) => e.offset === startingPosition - offset
                    );

                    if (!foundObject) {
                        throw new Error(
                            `Failed to find source object during ofs_delta read`
                        );
                    }

                    const dataBuffer = buffer.subarray(
                        currentPosition,
                        nextEntryOffset
                    );
                    const decompressed = await CompressionUtil.decompress(
                        dataBuffer
                    );

                    const sourceLengthBuffer = this.readVariableLengthBytes(
                        dataBuffer,
                        0
                    );
                    const targetLengthBuffer = this.readVariableLengthBytes(
                        dataBuffer,
                        sourceLengthBuffer.length
                    );

                    let decompressedCurrentPosition: number =
                        targetLengthBuffer.length + sourceLengthBuffer.length;
                    let resultBuffer = Buffer.alloc(0);
                    while (
                        decompressedCurrentPosition <
                        decompressed.length - 1
                    ) {
                        const instructionTypeByte =
                            decompressed[decompressedCurrentPosition];
                        const isCopyInstruction =
                            (instructionTypeByte & 0b1000_0000) === 0b1000_0000;
                        decompressedCurrentPosition += 1;

                        if (isCopyInstruction) {
                            // TODO: clean this up later, whoa dude this is cray
                            let copyOffset: number = 0;
                            let copySize: number = 0;

                            let byteIndexAvailable = 0;
                            let potentialBytes = [
                                decompressed[decompressedCurrentPosition],
                                decompressed[decompressedCurrentPosition + 1],
                                decompressed[decompressedCurrentPosition + 2],
                                decompressed[decompressedCurrentPosition + 3],
                            ];

                            if (
                                (instructionTypeByte & 0b0000_0001) ===
                                0b0000_0001
                            ) {
                                copyOffset =
                                    copyOffset |
                                    potentialBytes[byteIndexAvailable];
                                byteIndexAvailable++;
                                decompressedCurrentPosition++;
                            }

                            if (
                                (instructionTypeByte & 0b0000_0010) ===
                                0b0000_0010
                            ) {
                                copyOffset =
                                    copyOffset |
                                    (potentialBytes[byteIndexAvailable] << 8);
                                byteIndexAvailable++;
                                decompressedCurrentPosition++;
                            }

                            if (
                                (instructionTypeByte & 0b0000_0100) ===
                                0b0000_0100
                            ) {
                                copyOffset =
                                    copyOffset |
                                    (potentialBytes[byteIndexAvailable] << 16);
                                byteIndexAvailable++;
                                decompressedCurrentPosition++;
                            }

                            if (
                                (instructionTypeByte & 0b0000_1000) ===
                                0b0000_1000
                            ) {
                                copyOffset =
                                    copyOffset |
                                    (potentialBytes[byteIndexAvailable] << 24);
                                byteIndexAvailable++;
                                decompressedCurrentPosition++;
                            }

                            byteIndexAvailable = 0;
                            potentialBytes = [
                                decompressed[decompressedCurrentPosition],
                                decompressed[decompressedCurrentPosition + 1],
                                decompressed[decompressedCurrentPosition + 2],
                            ];

                            if (
                                (instructionTypeByte & 0b0001_0000) ===
                                0b0000_0000
                            ) {
                                copySize =
                                    copySize |
                                    potentialBytes[byteIndexAvailable];
                                byteIndexAvailable++;
                                decompressedCurrentPosition++;
                            }

                            if (
                                (instructionTypeByte & 0b0010_0000) ===
                                0b0010_0000
                            ) {
                                copySize =
                                    copySize |
                                    (potentialBytes[byteIndexAvailable] << 8);
                                byteIndexAvailable++;
                                decompressedCurrentPosition++;
                            }

                            if (
                                (instructionTypeByte & 0b0100_0000) ===
                                0b0100_0000
                            ) {
                                copySize =
                                    copySize |
                                    (potentialBytes[byteIndexAvailable] << 16);
                                byteIndexAvailable++;
                                decompressedCurrentPosition++;
                            }

                            resultBuffer = Buffer.from([
                                ...resultBuffer,
                                ...foundObject.rawData.subarray(
                                    copyOffset,
                                    copyOffset + copySize
                                ),
                            ]);
                        } else {
                            const insertSize =
                                instructionTypeByte & 0b0111_1111;
                            resultBuffer = Buffer.from([
                                ...resultBuffer,
                                ...decompressed.subarray(
                                    currentPosition,
                                    currentPosition + insertSize
                                ),
                            ]);
                            decompressedCurrentPosition += insertSize;
                        }
                    }

                    const rootType =
                        "rootType" in foundObject
                            ? foundObject.rootType
                            : foundObject.type;

                    entries.push({
                        id,
                        sizeInPack,
                        rootType,
                        type: "ofs_delta",
                        size: entrySize,
                        rawData: resultBuffer,
                        offset: startingPosition,
                        parent: foundObject,
                        depth:
                            "depth" in foundObject ? foundObject.depth + 1 : 1,
                    });
                }
            }
        }

        return {
            version,
            numEntries,
            entries,
        };
    }
}
