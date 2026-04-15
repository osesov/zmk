export function fuzzyMatchScore(search: string, target: string): number {
    if (search.length === 0) {
        return 0;
    }

    let searchIdx = 0;
    let targetIdx = 0;
    let score = 0;
    let consecutiveMatches = 0;

    while (searchIdx < search.length && targetIdx < target.length) {
        if (search[searchIdx] === target[targetIdx]) {
            searchIdx++;
            consecutiveMatches++;
            // Bonus for consecutive matches
            score += 1 + consecutiveMatches;

            // Extra bonus if match is at word boundary
            if (targetIdx === 0 || target[targetIdx - 1] === '/' || target[targetIdx - 1] === ':') {
                score += 5;
            }
        } else {
            consecutiveMatches = 0;
        }
        targetIdx++;
    }

    // If not all search characters were matched, return 0
    if (searchIdx < search.length) {
        return 0;
    }

    // Penalize based on length difference
    const lengthDiff = target.length - search.length;
    score -= lengthDiff * 0.1;

    return Math.max(0, score);
}
