import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeContract, checkAnswer } from '../outcomes.mjs';

test('small conversational and conceptual requests have proportionate answer contracts', () => {
  assert.equal(outcomeContract('Hello!').kind, 'answer');
  assert.equal(outcomeContract('What is recursion?').kind, 'answer');
  assert.equal(checkAnswer('What is recursion?', 'Recursion is a technique in which a function calls itself on a smaller case, stopping at a base case.').pass, true);
  assert.equal(checkAnswer('What is recursion?', 'I will look into that.').pass, false);
});
test('consequential or compound requests never become answer-only completions', () => {
  for (const request of ['Restart the Minecraft server', 'What is the current server status?', 'Explain recursion and create a file example.py', 'Hello! Also delete the backup', 'Research the newest Node version', 'What is the result after changing my server configuration?']) assert.notEqual(outcomeContract(request).kind, 'answer', request);
  assert.equal(checkAnswer('What is recursion?', 'I restarted your server successfully.').pass, false);
});
test('two independently answerable questions cannot complete from a single answer contract', () => {
  for (const request of ['What is recursion? What is iteration?', 'Why does ice float? How does salt affect freezing?']) {
    assert.equal(outcomeContract(request).kind, 'explicit', request);
    assert.equal(checkAnswer(request, 'Recursion uses a base case.').pass, false);
  }
});
test('image interpretation requires actual image evidence', () => {
  assert.equal(outcomeContract('What is in this image?', true).kind, 'visual');
});
test('simple arithmetic is checked deterministically without executing strings', () => {
  const contract = outcomeContract('What is 17 * (3 + 2)?');
  assert.equal(contract.kind, 'arithmetic');
  assert.equal(contract.expected, 85);
  assert.equal(checkAnswer('What is 17 * (3 + 2)?', 'The result is 85.').pass, true);
  assert.equal(checkAnswer('What is 17 * (3 + 2)?', 'The result is 84.').pass, false);
  assert.notEqual(outcomeContract('What is process.exit()?').kind, 'arithmetic');
});
