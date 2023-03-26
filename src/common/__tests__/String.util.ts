import { StringUtil } from "../String.util";

describe("StringUtil", () => {
    describe("findAllIndices", () => {
        it("should correctly compute all indices for a simple text search", () => {
            const result = StringUtil.findAllIndices(
                "dogs and cats are the same as cats and dogs which are the same as dogs and cats",
                "and"
            );
            expect(result).toEqual([5, 35, 71]);
        });
    });

    describe("splitStringAtPositions", () => {
        it("should correctly split the string at the provided incides", () => {
            const result = StringUtil.splitStringAtPositions(
                "some string",
                [2, 5, 8]
            );
            expect(result).toEqual(["so", "me ", "str", "ing"]);
        });

        it("should correctly handle indices outside of bounds", () => {
            const result = StringUtil.splitStringAtPositions(
                "some string",
                [-5, 2, 5, 8, 100]
            );
            expect(result).toEqual(["so", "me ", "str", "ing"]);
        });
    });
});
