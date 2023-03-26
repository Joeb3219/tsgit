import { HashUtil } from "../Hash.util"

describe('HashUtil', () => {
    describe('getHash', () => {
        it('should return the correct 40-digit hex value for a sample string', () => {
            const result = HashUtil.getHash('here is some content for a random string of text');
            expect(result.length).toEqual(40);
            expect(result).toEqual('1cc95013f7fb85bdb44184209b5ba499d6a74237');
        })
    })
})