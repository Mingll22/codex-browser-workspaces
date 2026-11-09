export const StatusError={TIMEOUT:'BROKER_STATUS_TIMEOUT',INVALID:'BROKER_STATUS_INVALID',BROWSER_QUERY:'STATUS_BROWSER_QUERY_FAILED',MIGRATION:'WORKSPACE_FAMILY_MIGRATION_REQUIRED'};

/** Shared status presentation for the popup and extension action. */
export function badgeForStatus(status) {
  if (status?.connection === 'CONNECTED' && Number.isSafeInteger(status.mcpConnections) && status.mcpConnections >= 0) {
    const count = status.mcpConnections;
    return {text: count >= 100 ? '99+' : String(count), color: '#1769dd', title: `Codex Browser Workspaces · ${count} 个 MCP 连接`};
  }
  const labels = {CONNECTED: '连接数未知', DISCONNECTED: '未连接', STALE: '状态已过期', ERROR: '连接异常'};
  return {text: '!', color: '#a55b21', title: `Codex Browser Workspaces · ${labels[status?.connection] || '状态未知'}`};
}

export function statusLabel(connection) {
  return {CONNECTED: '已连接', DISCONNECTED: '未连接', STALE: '状态过期', ERROR: '连接异常'}[connection] || '状态未知';
}

export function formatCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : '—';
}
