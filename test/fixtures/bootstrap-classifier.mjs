import { BOOTSTRAP_IDENTIFIERS } from "../../bootstrap-classifier.mjs";

export const repository = {
    nameWithOwner: "octodemo/demo",
    defaultBranch: "main",
};

export const NOW = "2026-09-21T12:00:00.000Z";

export function castPullRequest(overrides = {}) {
    return {
        number: 3,
        title: BOOTSTRAP_IDENTIFIERS.castPullRequestTitle,
        headRefName: BOOTSTRAP_IDENTIFIERS.castBranch,
        baseRefName: repository.defaultBranch,
        state: "OPEN",
        isDraft: true,
        url: "https://github.com/octodemo/demo/pull/3",
        createdAt: "2026-09-21T10:00:00Z",
        updatedAt: "2026-09-21T10:05:00Z",
        ...overrides,
    };
}

export function researchIssue(overrides = {}) {
    return {
        number: 6,
        title: BOOTSTRAP_IDENTIFIERS.researchIssueTitle,
        body: BOOTSTRAP_IDENTIFIERS.researchIssueMarker,
        state: "OPEN",
        url: "https://github.com/octodemo/demo/issues/6",
        createdAt: "2026-09-21T10:05:00Z",
        updatedAt: "2026-09-21T10:10:00Z",
        ...overrides,
    };
}

export function researchComment(overrides = {}) {
    const envelope = overrides.envelope || {
        squad_artifact: "research",
        schema_version: "1",
        origin_issue: 6,
        phases: [],
    };
    return {
        id: 9,
        author: { login: BOOTSTRAP_IDENTIFIERS.researchAuthor },
        body: `Bootstrap research\n\nStructured data:\n\`\`\`json\n${JSON.stringify(envelope)}\n\`\`\``,
        url: "https://github.com/octodemo/demo/issues/6#issuecomment-9",
        createdAt: "2026-09-21T10:15:00Z",
        ...overrides,
        envelope: undefined,
    };
}

export function workflowRun(overrides = {}) {
    return {
        databaseId: 20,
        workflowName: BOOTSTRAP_IDENTIFIERS.workflow,
        displayTitle: "Squad bootstrap — octodemo/demo",
        headBranch: repository.defaultBranch,
        status: "completed",
        conclusion: "success",
        url: "https://github.com/octodemo/demo/actions/runs/20",
        createdAt: "2026-09-21T10:00:00Z",
        updatedAt: "2026-09-21T10:10:00Z",
        ...overrides,
    };
}

export function workflow(overrides = {}) {
    return {
        name: BOOTSTRAP_IDENTIFIERS.workflow,
        path: ".github/workflows/squad-bootstrap.lock.yml",
        state: "active",
        url: "https://github.com/octodemo/demo/actions/workflows/squad-bootstrap.lock.yml",
        observedAt: "2026-09-21T11:50:00Z",
        ...overrides,
    };
}

export function classifyInput(overrides = {}) {
    return {
        repository,
        pullRequests: [],
        issues: [],
        comments: [],
        workflowRuns: [],
        workflows: [],
        now: NOW,
        ...overrides,
    };
}
