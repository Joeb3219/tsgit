import fs from "fs-extra";
import { GitObject } from "../GitObject";

describe("GitObject", () => {
    describe("readObjectFromContents", () => {
        it("should correctly parse a sample object", async () => {
            const buffer = await fs.readFile(
                "/Users/joeb3219/code/tsgit/.git/objects/a2/fa8ed8457d2a3c7c1adc6a703e30d4000df2ee"
            );

            const result = await GitObject.readObjectFromContents(buffer);
            expect(result).toMatchInlineSnapshot(`
                {
                  "data": "tree c5c69f8c72eba153d1142ce6e71192204e202718
                author Joseph A. Boyle <joseph.a.boyle@rutgers.edu> 1679806430 -0400
                committer Joseph A. Boyle <joseph.a.boyle@rutgers.edu> 1679806430 -0400

                Initial commit
                ",
                  "hash": "a2fa8ed8457d2a3c7c1adc6a703e30d4000df2ee",
                  "type": "commit",
                }
            `);
        });
    });
});
