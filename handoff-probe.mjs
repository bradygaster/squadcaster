const CACHE_TTL_MS = 60 * 1000;
const WRITE_PERMISSIONS = new Set(["admin", "maintain", "write"]);
const COPILOT_LOGINS = new Set(["copilot-swe-agent", "copilot"]);

const CAPABILITY_QUERY = `
query SquadcasterHandoffCapabilities($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    viewerPermission
    squadSource: object(expression: "HEAD:.github/workflows/squad.md") { ... on Blob { oid } }
    squadLock: object(expression: "HEAD:.github/workflows/squad.lock.yml") { ... on Blob { oid } }
    suggestedActors(first: 100, capabilities: [CAN_BE_ASSIGNED]) {
      nodes { login }
    }
  }
}`;

function clean(value, maxLength = 800) {
    return String(value ?? "").trim().slice(0, maxLength);
}

function parseGoalId(goalId) {
    const match = /^([^/\s#]+)\/([^/\s#]+)#([1-9][0-9]*)$/.exec(clean(goalId, 400));
    if (!match) return null;
    return {
        goalId: `${match[1]}/${match[2]}#${match[3]}`,
        repository: `${match[1]}/${match[2]}`,
        owner: match[1],
        name: match[2],
        issueNumber: Number(match[3]),
    };
}

function mechanism(kind, availability, reasons = []) {
    return {
        kind,
        availability,
        reasons: reasons.map((reason) => clean(reason)).filter(Boolean),
    };
}

function unavailableMechanisms(local, reason) {
    return [
        local,
        mechanism("copilot-cloud-agent", "unavailable", [reason]),
        mechanism("squad-implement", "unavailable", [reason]),
        mechanism("manual", "available"),
    ];
}

export class HandoffMechanismProbe {
    constructor({ runJson, cwd, now = () => Date.now(), ttlMs = CACHE_TTL_MS } = {}) {
        this.runJson = runJson;
        this.cwd = cwd;
        this.now = now;
        this.ttlMs = ttlMs;
        this.cache = new Map();
    }

    async probe({ state, goalId, force = false } = {}) {
        const identity = parseGoalId(goalId);
        const goal = (state?.activity?.goals || []).find((candidate) =>
            String(candidate?.id || "").toLowerCase() === String(identity?.goalId || "").toLowerCase());
        if (!identity || !goal?.handoff) {
            throw new Error("The requested handoff goal is not present in the normalized activity state.");
        }
        const revision = clean(goal.handoff.issueRevision || goal.issue?.updatedAt, 120);
        const cacheKey = identity.goalId.toLowerCase();
        const cached = this.cache.get(cacheKey);
        if (
            !force &&
            cached?.revision === revision &&
            this.now() - cached.checkedAt < this.ttlMs
        ) {
            return structuredClone(cached.value);
        }

        const currentRepository = clean(
            state?.activity?.currentRepository || state?.activity?.repository?.nameWithOwner,
            300,
        ).toLowerCase();
        const local = currentRepository === identity.repository.toLowerCase() && state?.repoRoot
            ? mechanism("local-session", "available")
            : mechanism("local-session", "unavailable", [
                "The selected repository is not configured in this local project session.",
            ]);

        let mechanisms;
        try {
            const result = await this.runJson([
                "api", "graphql",
                "-f", `query=${CAPABILITY_QUERY}`,
                "-F", `owner=${identity.owner}`,
                "-F", `name=${identity.name}`,
            ], this.cwd);
            const repository = result?.data?.repository;
            if (!repository) throw new Error("GitHub did not return the selected repository.");
            const permission = clean(repository.viewerPermission, 40).toLowerCase();
            const canWrite = WRITE_PERMISSIONS.has(permission);
            const actors = Array.isArray(repository.suggestedActors?.nodes)
                ? repository.suggestedActors.nodes
                : [];
            const copilotAssignable = actors.some((actor) =>
                COPILOT_LOGINS.has(clean(actor?.login, 120).toLowerCase()));
            const squadInstalled = Boolean(repository.squadSource || repository.squadLock);

            mechanisms = [
                local,
                copilotAssignable && canWrite
                    ? mechanism("copilot-cloud-agent", "available")
                    : mechanism("copilot-cloud-agent", "policy-blocked", [
                        !canWrite
                            ? "Write permission is required to assign Copilot."
                            : "Copilot cloud agent is not an assignable actor for this repository.",
                    ]),
                squadInstalled && canWrite
                    ? mechanism("squad-implement", "available")
                    : mechanism("squad-implement", "unavailable", [
                        !squadInstalled
                            ? "The repository's Squad implementation workflow is not installed."
                            : "Write permission is required to dispatch the Squad implementation workflow.",
                    ]),
                mechanism("manual", "available"),
            ];
        } catch (error) {
            mechanisms = unavailableMechanisms(
                local,
                `Unable to verify repository mechanism availability: ${clean(error?.message || error)}`,
            );
        }

        const value = {
            goalId: identity.goalId,
            checkedAt: new Date(this.now()).toISOString(),
            mechanisms,
        };
        this.cache.set(cacheKey, {
            checkedAt: this.now(),
            revision,
            value,
        });
        return structuredClone(value);
    }
}

export function applyHandoffMechanismOverlay(state, overlay) {
    const copy = structuredClone(state);
    const goal = (copy?.activity?.goals || []).find((candidate) =>
        String(candidate?.id || "").toLowerCase() === String(overlay?.goalId || "").toLowerCase());
    if (!goal?.handoff?.readiness || !Array.isArray(overlay?.mechanisms)) return copy;
    goal.handoff.mechanisms = structuredClone(overlay.mechanisms);
    goal.handoff.readiness.automatedHandoffAvailable =
        goal.handoff.readiness.state === "ready" &&
        overlay.mechanisms.some((item) =>
            item.kind !== "manual" && item.availability === "available");
    return copy;
}
