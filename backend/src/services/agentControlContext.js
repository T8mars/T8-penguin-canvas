const ACTIVE_CONTEXT_SCHEMA = 't8-agent-active-context-v1';

function createAgentControlContextService() {
  let provider = null;
  return {
    setProvider(value) { provider = typeof value === 'function' ? value : null; },
    async snapshot(instanceId) {
      const unavailable = { status: 'unavailable', resolution: null, activeWindowId: null,
        candidates: [], truncated: false, observedAt: new Date().toISOString() };
      let snapshot = unavailable;
      try { if (provider) snapshot = await provider(); } catch { /* No paths or raw IPC errors cross the API. */ }
      return { ...snapshot, schema: ACTIVE_CONTEXT_SCHEMA, instanceId };
    },
  };
}

const agentControlContextService = createAgentControlContextService();
module.exports = { ACTIVE_CONTEXT_SCHEMA, createAgentControlContextService, agentControlContextService };
