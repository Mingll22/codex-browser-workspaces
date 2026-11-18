import test from 'node:test';
import assert from 'node:assert/strict';
import {Upstream, UpstreamExecutionError} from '../dist/adapter/src/upstream.js';

const timedOut = () => Object.assign(new Error('timeout'), {code: -32001});

test('unknown page execution carries the dispatched identity and keeps the original timeout', async () => {
  const upstream = new Upstream('http://127.0.0.1:9222');
  const epoch = upstream.epoch;
  const calls = [];
  upstream.client = {
    async callTool(request) {
      calls.push(request);
      upstream.epoch = 'replacement';
      throw timedOut();
    },
  };

  await assert.rejects(upstream.call('click', {pageId: 7, uid: '1_1'}, ['owned']), error => {
    assert.ok(error instanceof UpstreamExecutionError);
    assert.equal(error.message, 'UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN');
    assert.deepEqual(error.details, {outcome: 'UNKNOWN', nextAction: 'wait_3_minutes_then_list_pages'});
    assert.deepEqual(error.pageExecution, {targetId: 'owned', pageId: 7, epoch});
    return true;
  });
  assert.deepEqual(calls.map(request => request.name), ['click']);
});

test('a snapshot cannot track the dialog queue or a call without exact page identity', async () => {
  const upstream = new Upstream('http://127.0.0.1:9222');
  upstream.client = {async callTool() { throw timedOut(); }};
  for (const [name, args, targets] of [
    ['handle_dialog', {pageId: 7}, ['owned']],
    ['click', {pageId: 7}, ['owned', 'other']],
    ['click', {}, ['owned']],
    ['list_pages', {}, ['owned']],
  ]) {
    await assert.rejects(upstream.call(name, args, targets), error => {
      assert.ok(!(error instanceof UpstreamExecutionError));
      assert.equal(error.message, 'UPSTREAM_TIMEOUT_OUTCOME_UNKNOWN');
      assert.equal(error.details.outcome, 'UNKNOWN');
      return true;
    });
  }
});

test('execution probe needs a successful scoped snapshot on the original connection', async () => {
  const upstream = new Upstream('http://127.0.0.1:9222');
  const execution = {targetId: 'owned', pageId: 7, epoch: upstream.epoch};
  upstream.ensure = () => assert.fail('execution probe must not reconnect');
  assert.equal(await upstream.checkPageExecution(execution), false);

  let complete;
  const reply = new Promise(resolve => { complete = resolve; });
  const calls = [];
  const client = {
    async callTool(request, schema, options) {
      calls.push({request, options});
      return reply;
    },
  };
  upstream.client = client;
  assert.equal(await upstream.checkPageExecution({...execution, epoch: 'old'}), false);
  assert.equal(calls.length, 0);

  const started = Date.now();
  const checking = upstream.checkPageExecution(execution);
  const {request, options} = calls[0];
  assert.equal(request.name, 'take_snapshot');
  assert.equal(request.arguments.pageId, 7);
  assert.deepEqual(request.arguments.__cbwTargetIds, ['owned']);
  assert.equal(options.timeout, 10000);
  assert.ok(request.arguments.__cbwDeadline >= started + options.timeout);
  assert.ok(request.arguments.__cbwDeadline <= Date.now() + options.timeout);

  upstream.client = {...client};
  complete({content: []});
  assert.equal(await checking, false);
  upstream.client = client;
  assert.equal(await upstream.checkPageExecution(execution), true);

  upstream.client = {async callTool() { return {content: [], isError: true}; }};
  assert.equal(await upstream.checkPageExecution(execution), false);
  upstream.client = {async callTool() { throw timedOut(); }};
  assert.equal(await upstream.checkPageExecution(execution), false);

  upstream.client = {
    async callTool() {
      upstream.epoch = 'replacement';
      return {content: []};
    },
  };
  assert.equal(await upstream.checkPageExecution(execution), false);
});
