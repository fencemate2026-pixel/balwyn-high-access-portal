import assert from 'node:assert/strict';
import test from 'node:test';
import { directFailureCode, safeFailureCode } from '../db/failure-code.ts';

// The log line for a failed direct database call must name the cause by code only.
test('failure codes name the cause and never carry a message', () => {
  assert.equal(safeFailureCode(Object.assign(new Error('password=secretpass host=db.example'), { code: '28P01' })), '28P01');
  assert.equal(safeFailureCode(Object.assign(new Error('x'), { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })), 'UNABLE_TO_VERIFY_LEAF_SIGNATURE');
  assert.equal(safeFailureCode(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), 'ECONNREFUSED');
  assert.equal(safeFailureCode(Object.assign(new Error('x'), { code: 'select * from users' })), 'unknown');
  assert.equal(safeFailureCode(new Error('secretpass')), 'unknown');
  assert.equal(safeFailureCode(null), 'unknown');
});

test('pg connection timeout has no code and is named CONNECTION_TIMEOUT', () => {
  assert.equal(directFailureCode(new Error('timeout exceeded when trying to connect')), 'CONNECTION_TIMEOUT');
  assert.equal(directFailureCode(new Error('Connection terminated due to connection timeout')), 'CONNECTION_TIMEOUT');
  assert.equal(directFailureCode(new Error('something else')), 'unknown');
  assert.equal(directFailureCode(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })), 'ETIMEDOUT');
});
