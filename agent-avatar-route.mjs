function cleanText(value, maxLength = 12000) {
    return String(value || "").trim().slice(0, maxLength);
}

function sendJson(res, status, body) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
}

function avatarMedia(bytes) {
    if (bytes.length >= 8 &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        return "image/png";
    }
    if (bytes.length >= 3 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[2] === 0xff) {
        return "image/jpeg";
    }
    if (bytes.length >= 6 &&
        ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) {
        return "image/gif";
    }
    if (bytes.length >= 12 &&
        bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
        bytes.subarray(8, 12).toString("ascii") === "WEBP") {
        return "image/webp";
    }
    return "";
}

function decodeCanonicalBase64(value) {
    if (typeof value !== "string" ||
        value.length === 0 ||
        value.length % 4 !== 0 ||
        value.length > Math.ceil((512 * 1024) / 3) * 4 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
        return null;
    }
    const bytes = Buffer.from(value, "base64");
    return bytes.toString("base64") === value ? bytes : null;
}

export async function handleAgentAvatarRoute(entry, req, res, defaultRunJson) {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname !== "/api/agent-avatar") return false;
    if (req.method !== "GET") {
        sendJson(res, 404, { error: "Not found." });
        return true;
    }

    const goalId = cleanText(url.searchParams.get("goal"), 300).toLowerCase();
    const goal = entry.state.activity?.goals?.find((candidate) =>
        String(candidate?.id || "").toLowerCase() === goalId);
    const identity = goal?.agentIdentity;
    const avatar = identity?.status === "resolved" &&
        ["fresh", "stale"].includes(identity?.source?.status)
        ? identity.record?.avatar
        : null;
    const agentId = identity?.record?.id;
    const repository = goal?.repository?.nameWithOwner;
    const expectedPrefix = `.squad/agents/${agentId}/`;
    if (!avatar ||
        avatar.kind !== "repository-path" ||
        typeof avatar.path !== "string" ||
        !avatar.path.startsWith(expectedPrefix) ||
        avatar.path.length === expectedPrefix.length ||
        avatar.path.includes("\\") ||
        avatar.path.split("/").some((segment) => segment === "." || segment === "..") ||
        !repository) {
        sendJson(res, 404, { error: "Authoritative avatar is unavailable." });
        return true;
    }
    const cacheKey = `${repository.toLowerCase()}\0${identity.source.revision}\0${avatar.path}`;
    const cached = entry.avatarCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        res.writeHead(200, {
            "Content-Type": cached.mediaType,
            "Content-Length": cached.bytes.length,
            "Cache-Control": "private, max-age=300",
            "X-Content-Type-Options": "nosniff",
        });
        res.end(cached.bytes);
        return true;
    }
    const encodedPath = avatar.path.split("/").map(encodeURIComponent).join("/");
    const response = await (entry.runJson || defaultRunJson)([
        "api",
        `repos/${repository}/contents/${encodedPath}`,
    ], entry.state.repoRoot);
    if (!response ||
        response.type !== "file" ||
        response.encoding !== "base64" ||
        typeof response.content !== "string") {
        sendJson(res, 404, { error: "Authoritative avatar content is unavailable." });
        return true;
    }
    const bytes = decodeCanonicalBase64(response.content);
    if (!bytes) {
        sendJson(res, 415, { error: "Authoritative avatar content is unsupported." });
        return true;
    }
    const mediaType = avatarMedia(bytes);
    if (!mediaType || bytes.length === 0 || bytes.length > 512 * 1024) {
        sendJson(res, 415, { error: "Authoritative avatar content is unsupported." });
        return true;
    }
    entry.avatarCache.set(cacheKey, {
        bytes,
        mediaType,
        expiresAt: Date.now() + 5 * 60 * 1000,
    });
    res.writeHead(200, {
        "Content-Type": mediaType,
        "Content-Length": bytes.length,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
    });
    res.end(bytes);
    return true;
}
