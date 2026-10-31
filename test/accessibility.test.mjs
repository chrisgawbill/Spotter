import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeElement } from '../src/stages/accessibility.mjs';

const byId = { heading: { textContent: ' Season\n totals ' } };
const element = ({ tag = 'input', id = '', attributes = {}, labels, innerText = '' } = {}) => ({
  tagName: tag.toUpperCase(),
  id,
  labels,
  innerText,
  getAttribute: (name) => attributes[name] ?? null,
  ownerDocument: { getElementById: (key) => byId[key] ?? null },
});

test('keyboard findings name elements by their accessible name, in priority order', () => {
  assert.equal(describeElement(element({ attributes: { 'aria-label': 'Search', placeholder: 'x' } })), 'input "Search"');
  assert.equal(describeElement(element({ tag: 'div', attributes: { 'aria-labelledby': 'heading missing' } })), 'div "Season totals"');
  assert.equal(describeElement(element({ labels: [{ innerText: 'Team' }], attributes: { placeholder: 'x' } })), 'input "Team"');
  assert.equal(describeElement(element({ attributes: { placeholder: 'Find a player', title: 'x' } })), 'input "Find a player"');
  assert.equal(describeElement(element({ tag: 'a', attributes: { title: 'Home' }, innerText: 'x' })), 'a "Home"');
  assert.equal(describeElement(element({ tag: 'button', innerText: '  Save\n changes ' })), 'button "Save changes"');
  assert.equal(describeElement(element({ attributes: { name: 'email' } })), 'input "email"');
  assert.equal(describeElement(element({ tag: 'button' })), 'button');
});

test('generated ids are left out; ids that read as words are kept', () => {
  for (const id of ['mantine-x91aq68rp', ':r0:', '«r1»', '_r_2_', 'radix-:r3:-trigger', 'headlessui-menu-button-1', 'field-x7k2q9b4']) {
    assert.equal(describeElement(element({ id, attributes: { 'aria-label': 'Go' } })), 'input "Go"', id);
  }
  for (const id of ['search', 'player-search', 'step2', 'h1', 'season_2026']) {
    assert.equal(describeElement(element({ id })), `input#${id}`, id);
  }
});
