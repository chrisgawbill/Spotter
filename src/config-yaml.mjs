import YAML from 'yaml';
import { configFields } from './config-fields.mjs';

/** Apply collection layouts from the same examples shown in the editor. */
export function formatConfig(config, originalSource) {
  const document = originalSource ? YAML.parseDocument(originalSource) : new YAML.Document(config);
  function fill(value, parts = []) {
    if (!document.hasIn(parts)) { document.setIn(parts, value); return; }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, child] of Object.entries(value)) fill(child, [...parts, key]);
    }
  }
  if (originalSource) for (const [key, value] of Object.entries(config)) fill(value, [key]);
  function layout(target, example) {
    if (!target || !example) return;
    if (YAML.isCollection(target) && YAML.isCollection(example) && example.flow) target.flow = true;
    if (YAML.isMap(target) && YAML.isMap(example)) {
      for (const pair of example.items) layout(target.get(pair.key.value, true), pair.value);
    } else if (YAML.isSeq(target) && YAML.isSeq(example)) {
      for (const item of target.items) layout(item, example.items.find((candidate) => candidate?.constructor === item?.constructor));
    }
  }
  for (const [key, field] of Object.entries(configFields)) {
    let example = YAML.parseDocument(field.example);
    const parent = key.split('.')[0];
    if (key.includes('.') && !example.has(parent)) {
      const wrapped = new YAML.Document();
      wrapped.set(parent, example.contents);
      example = wrapped;
    }
    layout(document.contents, example.contents);
  }
  return document.toString({ lineWidth: 0 });
}
