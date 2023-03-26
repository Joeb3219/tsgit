import fs from "fs-extra";
import { GitObject } from "../GitObject";

describe("GitObject", () => {
    describe("readObjectFromContents", () => {
        it("should correctly parse a sample blob object", async () => {
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
                  "size": 203,
                  "type": "commit",
                }
            `);
        });

        it("should correctly parse a sample tree object", async () => {
            const buffer = await fs.readFile(
                "/Users/joeb3219/code/tsgit/.git/objects/9b/2d795ef61117b4763778378c46d00961198250"
            );

            const result = await GitObject.readObjectFromContents(buffer);
            expect(result).toMatchInlineSnapshot(`
                {
                  "data": [
                    {
                      "hash": "457bfd76427c4afdfdfd70fd237469fdfd4e53fd",
                      "mode": 40000,
                      "path": "common",
                    },
                    {
                      "hash": "fd7546fd04fd5a68fdfd04fd7efdfdfd3d0cfd04",
                      "mode": 100644,
                      "path": "index.ts",
                    },
                  ],
                  "hash": "9b2d795ef61117b4763778378c46d00961198250",
                  "size": 69,
                  "type": "tree",
                }
            `);
        });
    });
});
