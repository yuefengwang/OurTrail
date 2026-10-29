'use strict';
/**
 * Minimal JSON-Schema (draft-07 subset) validator.
 *
 * Supported: $ref (local #/definitions, #/$defs), type, enum, const, required,
 * properties, additionalProperties, items, minItems/maxItems, minProperties/maxProperties,
 * minLength/maxLength,
 * pattern, minimum/maximum, exclusiveMinimum/exclusiveMaximum,
 * oneOf/anyOf/allOf/not, format (date-time | uri | sha256 | posix-path).
 *
 * Deliberately small: the contracts in this suite are ours, so an unsupported
 * keyword is a bug to fix rather than a case to tolerate. `validate` reports
 * unknown keywords as errors so a typo cannot silently disable a constraint.
 */
const KNOWN = new Set([
  '$schema', '$id', 'title', 'description', 'definitions', '$defs',
  '$ref', 'type', 'enum', 'const', 'required', 'properties', 'additionalProperties',
  'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern',
  'minProperties', 'maxProperties',
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum',
  'oneOf', 'anyOf', 'allOf', 'not', 'format', 'default', 'examples',
]);

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

function typeMatches(expected, value) {
  const actual = typeOf(value);
  if (expected === actual) return true;
  if (expected === 'number' && (actual === 'number' || actual === 'integer')) return true;
  if (expected === 'integer' && actual === 'integer') return true;
  return false;
}

function resolveRef(root, ref) {
  if (!ref.startsWith('#/')) return null;
  let cur = root;
  for (const seg of ref.slice(2).split('/')) {
    const key = decodeURIComponent(seg).replace(/~1/g, '/').replace(/~0/g, '~');
    if (!cur || typeof cur !== 'object' || !(key in cur)) return null;
    cur = cur[key];
  }
  return cur;
}

function validate(schema, value, opts) {
  const root = (opts && opts.root) || schema;
  const errors = [];
  const at = (opts && opts.path) || '$';

  const fail = (keyword, message, extra) => errors.push({ path: at, keyword, message, ...(extra || {}) });

  if (schema === true) return { valid: errors.length === 0, errors };
  if (schema === false) { fail('false', 'no value allowed'); return { valid: false, errors }; }
  if (!schema || typeof schema !== 'object') { fail('schema', 'schema must be an object'); return { valid: false, errors }; }

  for (const key of Object.keys(schema)) {
    if (!KNOWN.has(key)) fail('schema', `unknown schema keyword "${key}"`);
  }

  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (!target) { fail('$ref', `unresolvable ref ${schema.$ref}`); return { valid: false, errors }; }
    return validate(target, value, { root, path: at });
  }

  if (schema.const !== undefined && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    fail('const', `expected ${JSON.stringify(schema.const)}`, { expected: schema.const, actual: value });
  }
  if (schema.enum && !schema.enum.some(e => JSON.stringify(e) === JSON.stringify(value))) {
    fail('enum', `expected one of ${schema.enum.join(', ')}`, { expected: schema.enum, actual: value });
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => typeMatches(t, value))) {
      fail('type', `expected ${types.join('|')}, got ${typeOf(value)}`, { expected: types, actual: typeOf(value) });
      return { valid: false, errors };
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) fail('minLength', `length < ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) fail('maxLength', `length > ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('pattern', `does not match ${schema.pattern}`);
    if (schema.format) {
      const f = FORMATS[schema.format];
      if (!f) fail('format', `unsupported format ${schema.format}`);
      else if (!f(value)) fail('format', `not a valid ${schema.format}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) fail('minimum', `must be >= ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) fail('maximum', `must be <= ${schema.maximum}`);
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) fail('exclusiveMinimum', `must be > ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum != null && value >= schema.exclusiveMaximum) fail('exclusiveMaximum', `must be < ${schema.exclusiveMaximum}`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) fail('minItems', `fewer than ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) fail('maxItems', `more than ${schema.maxItems} items`);
    if (schema.items) {
      value.forEach((item, i) => {
        const sub = validate(schema.items, item, { root, path: `${at}[${i}]` });
        errors.push(...sub.errors);
      });
    }
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keyCount = Object.keys(value).length;
    if (schema.minProperties != null && keyCount < schema.minProperties) fail('minProperties', `fewer than ${schema.minProperties} properties`);
    if (schema.maxProperties != null && keyCount > schema.maxProperties) fail('maxProperties', `more than ${schema.maxProperties} properties`);
    for (const req of schema.required || []) {
      if (!(req in value)) fail('required', `missing required property "${req}"`, { expected: req });
    }
    const props = schema.properties || {};
    for (const key of Object.keys(value)) {
      if (props[key]) {
        const sub = validate(props[key], value[key], { root, path: `${at}.${key}` });
        errors.push(...sub.errors);
      } else if (schema.additionalProperties === false) {
        fail('additionalProperties', `unexpected property "${key}"`, { expected: Object.keys(props) });
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        const sub = validate(schema.additionalProperties, value[key], { root, path: `${at}.${key}` });
        errors.push(...sub.errors);
      }
    }
  }

  if (schema.allOf) for (const s of schema.allOf) errors.push(...validate(s, value, { root, path: at }).errors);
  if (schema.anyOf && !schema.anyOf.some(s => validate(s, value, { root, path: at }).valid)) {
    fail('anyOf', 'no branch matched');
  }
  if (schema.oneOf) {
    const matched = schema.oneOf.filter(s => validate(s, value, { root, path: at }).valid).length;
    if (matched !== 1) fail('oneOf', `matched ${matched} branches`);
  }
  if (schema.not && validate(schema.not, value, { root, path: at }).valid) fail('not', 'value matches forbidden schema');

  return { valid: errors.length === 0, errors };
}

const FORMATS = {
  'date-time': v => !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v),
  uri: v => /^[a-z][a-z0-9+.-]*:\/\//i.test(v),
  sha256: v => /^[0-9a-f]{64}$/.test(v),
  'posix-path': v => typeof v === 'string' && !v.includes('\\') && !/^[a-z]:/i.test(v),
};

function formatErrors(errors) {
  return errors.map(e => `${e.path}: ${e.message}`).join('\n');
}

function assertValid(schema, value, label) {
  const res = validate(schema, value);
  if (!res.valid) {
    const err = new Error(`${label || 'value'} does not satisfy schema:\n${formatErrors(res.errors)}`);
    err.code = 'SCHEMA_INVALID';
    err.errors = res.errors;
    throw err;
  }
  return value;
}

module.exports = { validate, assertValid, formatErrors, typeOf, FORMATS };
