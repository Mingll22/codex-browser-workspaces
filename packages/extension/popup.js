import {formatCount, statusLabel, StatusError} from './status.js';

const byId = id => document.getElementById(id);
const elements = Object.fromEntries(['connection', 'connection-label', 'refresh', 'mcp-count', 'thread-count', 'workspace-count', 'notice', 'workspace-list', 'workspace-tooltip'].map(id => [id, byId(id)]));
let currentStatus = null;
let updateSequence = 0;
const errorMessages = {
  [StatusError.TIMEOUT]: 'Broker 状态查询超时，请刷新重试。',
  [StatusError.INVALID]: 'Broker 返回的状态无效，请刷新重试。',
  [StatusError.BROWSER_QUERY]: '无法读取 Chrome 工作区，请刷新重试。',
  [StatusError.MIGRATION]: '工作区需要完成迁移，请检查安装状态。',
};

function textNode(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function workspaceRow(workspace) {
  const row = textNode('div', 'workspace', '');
  const mark = textNode('div', 'workspace-mark', '');
  mark.setAttribute('aria-hidden', 'true');
  // This fixed SVG contains no runtime data.
  mark.innerHTML = '<svg viewBox="0 0 20 20"><rect x="3" y="5" width="13" height="11" rx="2"/><path d="M6 5V3h10a2 2 0 0 1 2 2v8h-2M6 9h7"/></svg>';
  const content = textNode('div', 'workspace-content', '');
  const title = textNode('div', 'workspace-title', typeof workspace.title === 'string' && workspace.title.trim() ? workspace.title : '未命名工作区');
  title.tabIndex = 0;
  const tooltip = elements['workspace-tooltip'];
  const showTitle = () => {
    if (title.scrollWidth <= title.clientWidth) return;
    tooltip.textContent = title.textContent;
    tooltip.hidden = false;
    tooltip.style.top = '8px';
    const anchor = title.getBoundingClientRect();
    const height = tooltip.getBoundingClientRect().height;
    tooltip.style.top = `${Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - height - 8))}px`;
    tooltip.scrollTop = 0;
  };
  title.addEventListener('mouseenter', showTitle);
  title.addEventListener('focus', showTitle);
  title.addEventListener('mouseleave', () => { if (document.activeElement !== title) tooltip.hidden = true; });
  title.addEventListener('blur', () => { tooltip.hidden = true; });
  title.addEventListener('keydown', event => {
    if (event.key === 'Escape') tooltip.hidden = true;
    if (!tooltip.hidden && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      tooltip.scrollTop += event.key === 'ArrowDown' ? 32 : -32;
      event.preventDefault();
    }
  });
  const details = textNode('div', 'workspace-details', '');
  for (const [label, value] of [['页面', workspace.pageCount], ['租用', workspace.leasedPages], ['受保护', workspace.protectedPages]]) {
    details.append(textNode('span', '', `${label} ${formatCount(value)}`));
  }
  content.append(title, details);
  row.append(mark, content);
  return row;
}

function render(status) {
  currentStatus = status;
  const connection = ['CONNECTED', 'DISCONNECTED', 'ERROR', 'STALE'].includes(status?.connection) ? status.connection : 'ERROR';
  const hasObservation = Number.isFinite(status?.observedAt);
  const workspaces = Array.isArray(status?.workspaces) ? status.workspaces : [];
  const isCurrent = connection === 'CONNECTED' && hasObservation && !status?.error;
  elements.connection.dataset.state = connection;
  elements['connection-label'].textContent = statusLabel(connection);
  elements['mcp-count'].textContent = hasObservation ? formatCount(status.mcpConnections) : '—';
  elements['thread-count'].textContent = hasObservation ? formatCount(status.activeThreads) : '—';
  elements['workspace-count'].textContent = hasObservation && Array.isArray(status?.workspaces) ? formatCount(workspaces.length) : '—';
  elements.notice.hidden = isCurrent;
  const reason = errorMessages[status?.error] || ({DISCONNECTED: 'Broker 未连接，请刷新重试。', STALE: '状态已过期，请刷新重试。', ERROR: '暂时无法获取状态，请刷新重试。'}[connection] || '暂时无法获取状态，请刷新重试。');
  elements.notice.textContent = `${hasObservation ? '当前状态不可确认，面板显示上次数据。 ' : ''}${reason}`;
  elements['workspace-tooltip'].hidden = true;
  elements['workspace-list'].replaceChildren();
  if (hasObservation && workspaces.length) {
    for (const workspace of workspaces) elements['workspace-list'].append(workspaceRow(workspace));
  } else {
    const message = isCurrent ? '暂无工作区' : hasObservation ? '上次没有工作区' : '工作区状态未知';
    elements['workspace-list'].append(textNode('div', 'empty', message));
  }
}

async function refresh(force = false) {
  const startedAt = updateSequence;
  elements.refresh.disabled = true;
  try {
    const status = await chrome.runtime.sendMessage({type: 'cbw:get_status', ...(force ? {refresh: true} : {})});
    // A newer push is more authoritative than an earlier request response.
    if (startedAt === updateSequence) render(status || {connection: 'ERROR'});
  } catch {
    if (startedAt === updateSequence) render({...currentStatus, connection: 'ERROR'});
  } finally {
    elements.refresh.disabled = false;
  }
}

elements.refresh.addEventListener('click', () => refresh(true));
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'cbw:status' && message.status) {
    updateSequence += 1;
    render(message.status);
  }
});
// The port exists only while the popup is open; Chrome closes it with the popup.
const popupPort = chrome.runtime.connect?.({name: 'cbw:popup'});
refresh();
