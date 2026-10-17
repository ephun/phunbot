import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../ui.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../ui.css', import.meta.url), 'utf8');

test('goal detail keeps lifecycle controls but removes authorization and plan-history foreground UI', () => {
  assert.match(ui, /addAction\('Pause', 'pause'\)/);
  assert.match(ui, /addAction\('Cancel', 'cancel'\)/);
  assert.match(ui, /addAction\('Complete', 'complete'\)/);
  assert.match(ui, /addAction\('Resume', 'resume'\)/);
  assert.doesNotMatch(ui, /Pending authorization|Copy owner command|function authorization|function decideAuth|\bApprove\b|\bDeny\b/);
  assert.doesNotMatch(ui, /Plan changes|Previous plans|plan-history/);
  assert.doesNotMatch(css, /\.authorization|\.dialog-actions|\.plan-change/);
});

test('permission waiting is observational and links back to the conversation', () => {
  assert.match(ui, /Waiting for your response/);
  assert.doesNotMatch(ui, /Waiting for your approval|Waiting for your answer/);
  assert.match(ui, /showChat\(String\(c\.id\)\)/);
});

test('assistant response rendering guards empty bubbles and orphan copy controls', () => {
  assert.match(ui, /if \(m\.role === 'assistant' && !String\(m\.text \|\| ''\)\.trim\(\)\) return null/);
  assert.match(ui, /if \(String\(m\.text \|\| ''\)\.trim\(\)/);
  assert.match(ui, /\.filter\(m => m\.role !== 'assistant' \|\| String\(m\.text \|\| ''\)\.trim\(\) \|\| m\.images\?\.length\)/);
  assert.match(ui, /if \(code && code\.textContent\.trim\(\)\)/);
  assert.doesNotMatch(ui, /debug|regex-filter/i);
});
