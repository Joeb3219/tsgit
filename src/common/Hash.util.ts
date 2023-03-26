import crypto from 'crypto';

export class HashUtil {
    static getHash(str: string | Buffer): string {
        return crypto.createHash('sha1').update(str).digest('hex');
    }
}