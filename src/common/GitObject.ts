import { CompressionUtil } from "./Compression.util";
import { HashUtil } from "./Hash.util";
import fs from 'fs-extra';
import { GitDirectory } from "./GitDirectory";

export type GitObjectData = {
    type: 'blob' | 'commit' | 'tree';
    data: string;
    hash: string;
    size: number;
}

export class GitObject {
    static async readObjectFromContents(str: string | Buffer): Promise<GitObjectData> {
        const decompressed = await CompressionUtil.decompress(str);

        const [header, data] = decompressed.toString().split('\0');
        const [type, contentSizeString] = header.split(' ');
        
        if (type !== 'blob' && type !== 'commit' && type !== 'tree') {
            throw new Error(`Expected to receive object type of blob, commit, or tree, but received ${type}`);
        }

        const contentSize = parseInt(contentSizeString, 10);
        if (type === 'blob' && contentSize !== data.length) {
            throw new Error(`Expected to read content of length ${contentSize}, but found content of length ${data.length}`);
        }

        return {
            type,
            data,
            hash: HashUtil.getHash(decompressed),
            size: contentSize
        }
    }

    static async readObjectFromDisk(hash: string): Promise<GitObjectData> {
        const path = await GitDirectory.getObjectPath(hash);
        const file = await fs.readFile(path);
        const object = await this.readObjectFromContents(file);

        if (object.hash !== hash) {
            throw new Error(`Object stored with hash ${hash} is invalid (found hash ${object.hash})`)
        }

        return object;
    }
}