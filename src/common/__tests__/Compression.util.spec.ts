import fs from "fs-extra";
import { CompressionUtil } from "../Compression.util";
import { HashUtil } from "../Hash.util";

describe("CompressionUtil", () => {
    describe("decompress", () => {
        it("should decompress and return the correct value", async () => {
            const buffer = await fs.readFile(
                "/Users/joeb3219/code/tsgit/.git/objects/a2/fa8ed8457d2a3c7c1adc6a703e30d4000df2ee"
            );
            console.log(buffer);
            const result = await CompressionUtil.decompress(buffer);
            const x = HashUtil.getHash(result.toString());
            expect(x).toEqual("a2fa8ed8457d2a3c7c1adc6a703e30d4000df2ee");
            expect(result.toString()).toMatchInlineSnapshot(`
                "commit 203 tree c5c69f8c72eba153d1142ce6e71192204e202718
                author Joseph A. Boyle <joseph.a.boyle@rutgers.edu> 1679806430 -0400
                committer Joseph A. Boyle <joseph.a.boyle@rutgers.edu> 1679806430 -0400

                Initial commit
                "
            `);
        });
    });
});
