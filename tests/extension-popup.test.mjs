import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {badgeForStatus} from '../packages/extension/status.js';

test('badge reflects known connection count and does not report unknown as zero', () => {
  assert.equal(badgeForStatus({connection: 'CONNECTED', mcpConnections: 0}).text, '0');
  assert.equal(badgeForStatus({connection: 'CONNECTED', mcpConnections: 4}).text, '4');
  assert.equal(badgeForStatus({connection: 'CONNECTED', mcpConnections: 100}).text, '99+');
  for (const status of [{connection: 'CONNECTED', mcpConnections: null}, {connection: 'STALE', mcpConnections: 4}, {connection: 'DISCONNECTED'}, {connection: 'ERROR'}]) {
    assert.equal(badgeForStatus(status).text, '!');
    assert.ok(badgeForStatus(status).title);
  }
});

test('popup handles snapshot, refresh, stale data and accessible full titles', async () => {
  class Element {
    constructor() { this.dataset = {}; this.children = []; this.events = {}; this.textContent = ''; this.style = {}; this.scrollWidth = 300; this.clientWidth = 100; this.scrollTop = 0; }
    getBoundingClientRect() { return {bottom: 200, height: 40}; }
    setAttribute() {}
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    addEventListener(type, handler) { this.events[type] = handler; }
  }
  const ids = ['connection', 'connection-label', 'refresh', 'mcp-count', 'thread-count', 'workspace-count', 'notice', 'workspace-list', 'workspace-tooltip'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
  globalThis.document = {getElementById: id => nodes[id], createElement: () => new Element()};
  globalThis.window = {innerHeight: 500};
  let status = {connection: 'CONNECTED', observedAt: 1730000000000, extensionVersion: '0.4.0', brokerVersion: '0.4.0', mcpConnections: 2, activeThreads: 3, workspaces: [{groupId: 1, title: 'Private title', pageCount: 5, leasedPages: 2, protectedPages: 1}]};
  const requests = [];
  let listener;
  const connections = [];
  globalThis.chrome = {runtime: {connect: options => {connections.push(options); return {};}, sendMessage: async message => {requests.push(message); return status;}, onMessage: {addListener: callback => {listener = callback;}}}};
  await import('../packages/extension/popup.js');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(connections, [{name: 'cbw:popup'}]);
  assert.deepEqual(requests[0], {type: 'cbw:get_status'});
  assert.equal(nodes['mcp-count'].textContent, '2');
  assert.equal(nodes['workspace-count'].textContent, '1');
  assert.equal(nodes.notice.hidden, true);
  assert.equal(nodes['workspace-list'].children.length, 1);
  const title = nodes['workspace-list'].children[0].children[1].children[0];
  assert.equal(title.tabIndex, 0);
  title.events.focus();
  assert.equal(nodes['workspace-tooltip'].hidden, false);
  assert.equal(nodes['workspace-tooltip'].textContent, 'Private title');
  title.events.blur();
  assert.equal(nodes['workspace-tooltip'].hidden, true);
  title.events.mouseenter();
  assert.equal(nodes['workspace-tooltip'].hidden, false);
  title.events.mouseleave();
  assert.equal(nodes['workspace-tooltip'].hidden, true);
  status = {...status, connection: 'STALE'};
  await nodes.refresh.events.click();
  assert.deepEqual(requests[1], {type: 'cbw:get_status', refresh: true});
  assert.match(nodes.notice.textContent, /上次数据/);
  for (const [error, message] of [['BROKER_STATUS_TIMEOUT', 'Broker 状态查询超时'], ['BROKER_STATUS_INVALID', 'Broker 返回的状态无效'], ['STATUS_BROWSER_QUERY_FAILED', '无法读取 Chrome 工作区'], ['WORKSPACE_FAMILY_MIGRATION_REQUIRED', '工作区需要完成迁移']]) {
    listener({type: 'cbw:status', status: {...status, connection: 'ERROR', error}});
    assert.match(nodes.notice.textContent, new RegExp(message));
    assert.match(nodes.notice.textContent, /上次数据/);
    assert.equal(nodes['workspace-list'].children.length, 1);
  }
  listener({type: 'cbw:status', status: {...status, connection: 'ERROR', error: 'secret-token'}});
  assert.doesNotMatch(nodes.notice.textContent, /secret-token/);
  listener({type: 'cbw:status', status: {connection: 'DISCONNECTED', observedAt: null, mcpConnections: null, activeThreads: null, workspaces: []}});
  assert.equal(nodes['mcp-count'].textContent, '—');
  assert.equal(nodes['workspace-count'].textContent, '—');
  assert.equal(nodes['workspace-list'].children[0].textContent, '工作区状态未知');
});

test('manifest exposes popup and all extension icon sizes', async () => {
  const html = await readFile(new URL('../packages/extension/popup.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="notice"') < html.indexOf('class="metrics"'));
  const manifest = JSON.parse(await readFile(new URL('../packages/extension/manifest.json', import.meta.url)));
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.permissions.includes('clipboardWrite'), false);
  for (const size of [16, 32, 48, 128]) {
    assert.equal(manifest.action.default_icon[size], manifest.icons[size]);
    const png = await readFile(new URL(`../packages/extension/${manifest.icons[size]}`, import.meta.url));
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
