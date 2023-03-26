import zlib from "zlib";

export class CompressionUtil {
    static async compress(str: string | Buffer): Promise<Buffer> {
        return new Promise((res, rej) => {
            zlib.deflate(str, (err, result) => {
                if (err) {
                    rej(err);
                    return;
                }

                res(result);
            });
        });
    }

    static async decompress(str: string | Buffer): Promise<Buffer> {
        return new Promise((res, rej) => {
            zlib.inflate(str, (err, result) => {
                if (err) {
                    rej(err);
                    return;
                }

                res(result);
            });
        });
    }
}
