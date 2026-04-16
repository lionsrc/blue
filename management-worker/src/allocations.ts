export const ALLOCATION_PORT_MIN_VAL = 10000;
export const ALLOCATION_PORT_MAX_VAL = 50000;

export const findAvailableAllocationPort = async (db: D1Database, nodeId: string) => {
    const { results: existingAllocations } = await db.prepare(
        `SELECT port FROM UserAllocations WHERE nodeId = ?`
    ).bind(nodeId).all() as { results: { port: number }[] };
    const usedPorts = new Set(existingAllocations.map((allocation) => allocation.port));

    for (let candidate = ALLOCATION_PORT_MIN_VAL; candidate <= ALLOCATION_PORT_MAX_VAL; candidate += 1) {
        if (!usedPorts.has(candidate)) {
            return candidate;
        }
    }

    return null;
};
