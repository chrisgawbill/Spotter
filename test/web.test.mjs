import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isBrowserCancelled } from '../src/stages/web.mjs';

test('requests the browser cancelled itself are not failures in any engine', () => {
  for (const text of ['net::ERR_ABORTED', 'NS_BINDING_ABORTED', 'cancelled', 'Load request cancelled']) assert.equal(isBrowserCancelled(text), true, text);
  // Real failures, including injected disconnects, stay reported.
  for (const text of ['net::ERR_NAME_NOT_RESOLVED', 'NS_ERROR_CONNECTION_REFUSED', 'NS_ERROR_OFFLINE', 'net::ERR_INTERNET_DISCONNECTED', 'Could not connect to the server.', 'failed']) assert.equal(isBrowserCancelled(text), false, text);
});
