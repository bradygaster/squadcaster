export function emptyActivity() {
    return {
        schemaVersion: 2,
        fetchedAt: null,
        repository: {},
        repositories: [],
        summary: { active: 0, blocked: 0, failed: 0, awaitingReview: 0, completed: 0 },
        goals: [],
        errors: [],
    };
}

export function normalizePersistedState(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    return {
        version: 3,
        activity: source.activity?.schemaVersion === 2 ? source.activity : emptyActivity(),
    };
}
