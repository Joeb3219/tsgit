import _ from "lodash";

export class StringUtil {
    static splitStringAtPositions(str: string, positions: number[]): string[] {
        const results = positions.map((position, idx) => {
            // We are the first position, so we grab from 0 to position
            if (idx === 0) {
                return str.substring(0, position);
            }

            // Otherwise we grab from previous position to current position
            return str.substring(positions[idx - 1] ?? 0, position);
        });

        // We add an extra string for the last bit to ensure we don't miss any entries
        // We filter for all entries to be at least length 1 for safety.
        return [
            ...results,
            str.substring(_.max(positions) ?? str.length),
        ].filter((r) => r.length > 0);
    }

    static findAllIndices(str: string, pattern: string): number[] {
        return _.compact(
            [...str.matchAll(new RegExp(pattern, "gi"))].map((a) => a.index)
        );
    }
}
