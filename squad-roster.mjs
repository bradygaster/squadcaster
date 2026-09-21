function slug(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "member";
}

function cleanText(value, maxLength = 12000) {
    return String(value || "").trim().slice(0, maxLength);
}

export function normalizeMembers(members) {
    const seen = new Set();
    return (Array.isArray(members) ? members : [])
        .slice(0, 24)
        .map((member, index) => {
            let id = slug(member?.id || member?.name || `member-${index + 1}`);
            while (seen.has(id)) id = `${id}-${index + 1}`;
            seen.add(id);
            return {
                id,
                name: cleanText(member?.name || `Member ${index + 1}`, 80),
                role: cleanText(member?.role || "Specialist", 120),
                rationale: cleanText(member?.rationale || "", 1200),
                charter: cleanText(member?.charter || "", 12000),
                lead: Boolean(member?.lead),
                reviewer: Boolean(member?.reviewer),
                charterPath: cleanText(member?.charterPath || "", 320),
                status: cleanText(member?.status || "Active", 40),
            };
        });
}

export async function parseTeamMarkdown(content, { loadCharter = async () => "" } = {}) {
    const lines = String(content || "").split(/\r?\n/);
    const members = [];
    let foundMembers = false;
    let inMembers = false;

    for (const line of lines) {
        if (/^##\s+Members\b/i.test(line)) {
            foundMembers = true;
            inMembers = true;
            continue;
        }
        if (inMembers && /^##\s+/.test(line)) break;
        if (!inMembers || !line.trim().startsWith("|")) continue;

        const columns = line.split("|").slice(1, -1).map((column) => column.trim());
        if (columns.length < 3) continue;
        if (/^(name|[-:]+)$/i.test(columns[0])) continue;

        const name = columns[0].replaceAll("**", "").trim();
        const role = columns[1].replaceAll("**", "").trim();
        const charterMatch = columns[2].match(/`([^`]+)`/);
        const charterPath = charterMatch?.[1] || "";
        if (!name || name.startsWith("@")) continue;

        members.push({
            id: slug(name),
            name,
            role,
            rationale: `Configured in .squad/team.md as ${role}.`,
            charter: await loadCharter(charterPath),
            charterPath,
            lead: /\blead\b/i.test(role),
            reviewer: /quality|review/i.test(role),
            status: columns[3]?.replace(/[✅📋🔄🤖]/gu, "").trim() || "Active",
        });
    }

    if (!foundMembers || members.length === 0) {
        throw new Error("The Squad roster does not contain a valid Members table.");
    }
    return normalizeMembers(members);
}
