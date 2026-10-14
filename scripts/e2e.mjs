// Copyright 2026 Daud Zulfacar, Pandr UG (haftungsbeschränkt)
// SPDX-License-Identifier: Apache-2.0
/**
 * Tier-1 E2E: observe the unchanged provider's actual kernel binding over its
 * private child IPC channel, then run the unchanged signed consumer flow.
 * HTTP/console output alone never establishes ownership. This is internal
 * test observation, not a protocol identity rule or malicious-provider defense.
 * Binding and HTTP readiness share one 5s deadline; consumer has a 15s bound.
 * All paths reap only our own children, with bounded TERM/KILL escalation.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import path from 'node:path';
const script = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(script), '..');
const PORT = 4101, HOST = '127.0.0.1', FAMILY = 'IPv4';
const ORIGIN = `http://${HOST}:${PORT}`;
const expectedAddress = a => a && typeof a === 'object' &&
  a.address === HOST && a.port === PORT && a.family === FAMILY;

if (process.argv.includes('--provider-child')) {
  if (typeof process.send !== 'function') throw new Error('provider child requires private IPC');
  let reported = false;
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    this.once('listening', () => {
      const address = this.address();
      if (!reported && expectedAddress(address)) {
        reported = true;
        process.send({ type: 'provider-bound', pid: process.pid, address });
      }
    });
    return listen.apply(this, args);
  };
  await import(path.join(repoRoot, 'examples/provider/server.mjs'));
} else {
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Wait without leaving a deadline timer keeping the supervisor alive.
  async function bounded(promise, ms, timeoutValue) {
    let timer;
    try { return await Promise.race([promise, new Promise(resolve => {
      timer = setTimeout(() => resolve(timeoutValue), Math.max(0, ms));
    })]); } finally { clearTimeout(timer); }
  }
  function track(child) {
    const state = { child, exited: false, closed: false, failure: null };
    let fail;
    state.failed = new Promise(resolve => { fail = resolve; });
    const mark = reason => { state.failure ||= reason; fail(state.failure); };
    child.once('exit', (code, signal) => {
      state.exited = true;
      mark(`provider exited unexpectedly (code ${code}, signal ${signal})`);
    });
    child.once('error', error => mark(`child error: ${error.message}`));
    child.once('disconnect', () => mark('provider IPC disconnected unexpectedly'));
    state.done = new Promise(resolve => child.once('close', (code, signal) => {
      state.closed = true; resolve({code, signal});
    }));
    return state;
  }
  async function cleanup(state) {
    if (!state || state.closed) return;
    // child.kill uses the original handle; never probe/kill a potentially reused PID.
    state.child.kill('SIGTERM');
    if (await bounded(state.done, 2000, null)) return;
    state.child.kill('SIGKILL');
    if (!await bounded(state.done, 2000, null)) throw new Error('own child failed to close after SIGKILL');
  }
  let provider, consumer;
  let verdict = 1;
  try {
    const deadline = Date.now() + 5000;
    console.log('[e2e] spawning provider child…');
    provider = track(spawn(process.execPath, [script, '--provider-child'], {
      env: {...process.env, PORT:String(PORT), HOST, PUBLIC_ORIGIN:ORIGIN},
      stdio:['ignore','pipe','pipe','ipc'],
    }));
    provider.child.stdout.on('data', b => process.stdout.write(`[provider] ${b}`));
    provider.child.stderr.on('data', b => process.stderr.write(`[provider-err] ${b}`));
    const bound = await bounded(Promise.race([
      new Promise(resolve => provider.child.once('message', message => resolve({message}))),
      provider.failed.then(reason => ({reason})),
    ]), deadline-Date.now(), {reason:'bound-timeout'});
    if (bound.reason || provider.failure || !bound.message ||
        bound.message.type !== 'provider-bound' || bound.message.pid !== provider.child.pid ||
        !expectedAddress(bound.message.address)) {
      throw new Error(`provider did not send owned-bound signal (${bound.reason || provider.failure || 'wrong-message'})`);
    }
    console.log(`[e2e] provider owned-bound confirmed (pid=${provider.child.pid}, addr=${HOST}:${PORT})`);
    let ready = false;
    while (Date.now() < deadline && !provider.failure) {
      try {
        const response = await fetch(`${ORIGIN}/.well-known/proofmeta.json`, {
          signal: AbortSignal.timeout(Math.max(1, Math.min(500, deadline-Date.now()))),
        });
        // Recheck after await: an exit/disconnect observed during HTTP is fatal.
        ready = response.ok && !provider.failure && Date.now() < deadline;
        await response.body?.cancel();
        // Recheck original deadline and failure after cancel await; elapsed D or new failure must fail-close.
        if (ready && (Date.now() >= deadline || provider.failure)) ready = false;
        if (ready) break;
      } catch { /* readiness retries stay within the original deadline */ }
      await bounded(provider.failed, Math.min(100, Math.max(0, deadline-Date.now())), null);
    }
    if (!ready || provider.failure) throw new Error(provider.failure || 'provider HTTP endpoint not ready after owned-bound');
    console.log('[e2e] provider ready — running consumer…');
    // Final deadline guard immediately before spawn — no await between this check and spawn call.
    if (Date.now() >= deadline || provider.failure) throw new Error(provider.failure || 'deadline elapsed before consumer spawn');
    consumer = track(spawn(process.execPath, [path.join(repoRoot,'examples/consumer/client.mjs')], {
      env:{...process.env, PROVIDER_ORIGIN:ORIGIN}, stdio:['ignore','pipe','pipe'],
    }));
    let output = '';
    consumer.child.stdout.on('data', b => { output += b; process.stdout.write(b); });
    consumer.child.stderr.on('data', b => process.stderr.write(b));
    const result = await bounded(Promise.race([
      consumer.done.then(info => ({info})),
      provider.failed.then(reason => ({reason})),
    ]), 15000, {reason:'consumer timeout (15s deadline)'});
    // Provider failure is sticky until consumer close; success cannot win an
    // already observed provider exit merely by promise callback ordering.
    if (result.reason || provider.failure) throw new Error(`${result.reason || provider.failure} during consumer run`);
    if (result.info.code !== 0 || !output.includes('[consumer] full Tier-1 flow completed OK')) {
      throw new Error(`consumer exited with ${result.info.code} or missing completion marker`);
    }
    verdict = 0;
  } catch (error) {
    console.error(`[e2e] FAIL — ${error.message}`);
  } finally {
    // Close consumer before provider. Always attempt both cleanups even if one fails.
    const results = await Promise.allSettled([cleanup(consumer), cleanup(provider)]);
    for (const result of results) if (result.status === 'rejected') {
      verdict = 1; console.error(`[e2e] FAIL — cleanup: ${result.reason.message}`);
    }
  }
  if (verdict === 0) console.log('[e2e] PASS — Tier-1 end-to-end flow completed');
  process.exitCode = verdict;
}
