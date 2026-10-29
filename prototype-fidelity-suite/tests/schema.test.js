'use strict';
/**
 * The schema validator is deliberately small. These tests pin the supported
 * subset and, more importantly, pin its failure modes: an unknown keyword or an
 * unsupported format must be an error, not a silently ignored constraint.
 */
const { check, eq, section, finish, throws } = require('./harness');
const schema = require('../core/lib/schema');

const ok = (s, v) => schema.validate(s, v).valid;
const errs = (s, v) => schema.validate(s, v).errors;

section('types');
{
  check('string', ok({ type: 'string' }, 'x'));
  check('integer accepts integer', ok({ type: 'integer' }, 3));
  check('integer rejects float', !ok({ type: 'integer' }, 3.5));
  check('number accepts integer', ok({ type: 'number' }, 3));
  check('array', ok({ type: 'array' }, []));
  check('object', ok({ type: 'object' }, {}));
  check('null', ok({ type: 'null' }, null));
  check('boolean', ok({ type: 'boolean' }, false));
  check('type union', ok({ type: ['string', 'null'] }, null));
  const e = errs({ type: 'string' }, 5);
  eq('type error is reported once', e.length, 1);
  eq('with the actual type', e[0].actual, 'integer');
}

section('values');
{
  check('enum member', ok({ enum: ['PASS', 'FAIL'] }, 'FAIL'));
  check('enum outsider', !ok({ enum: ['PASS', 'FAIL'] }, 'pass'));
  check('const', ok({ const: '1.0.0' }, '1.0.0'));
  check('const mismatch', !ok({ const: '1.0.0' }, '1.0.1'));
  check('minimum inclusive', ok({ minimum: 0 }, 0));
  check('minimum violated', !ok({ minimum: 0 }, -1));
  check('maximum inclusive', ok({ maximum: 1 }, 1));
  check('maximum violated', !ok({ maximum: 1 }, 2));
  check('exclusiveMinimum rejects the boundary', !ok({ exclusiveMinimum: 0 }, 0));
  check('exclusiveMinimum accepts above', ok({ exclusiveMinimum: 0 }, 0.1));
  check('exclusiveMaximum rejects the boundary', !ok({ exclusiveMaximum: 1 }, 1));
  check('exclusiveMaximum accepts below', ok({ exclusiveMaximum: 1 }, 0.9));
}

section('strings');
{
  check('minLength', !ok({ minLength: 3 }, 'ab'));
  check('maxLength', !ok({ maxLength: 3 }, 'abcd'));
  check('pattern', ok({ pattern: '^[a-z]+$' }, 'abc'));
  check('pattern violated', !ok({ pattern: '^[a-z]+$' }, 'Abc'));

  check('date-time', ok({ format: 'date-time' }, '2026-10-28T12:00:00.000Z'));
  check('date-time needs a T', !ok({ format: 'date-time' }, '2026-10-28 12:00'));
  check('uri', ok({ format: 'uri' }, 'https://example.com/x'));
  check('uri rejects a path', !ok({ format: 'uri' }, '/pages/weather/weather'));
  check('sha256', ok({ format: 'sha256' }, 'a'.repeat(64)));
  check('sha256 length', !ok({ format: 'sha256' }, 'a'.repeat(63)));
  check('sha256 hex only', !ok({ format: 'sha256' }, 'g'.repeat(64)));
  check('posix-path', ok({ format: 'posix-path' }, 'captures/page/state/prototype.png'));
  check('posix-path rejects backslash', !ok({ format: 'posix-path' }, 'captures\\page\\state.png'));
  check('posix-path rejects a drive letter', !ok({ format: 'posix-path' }, 'C:/captures/x.png'));

  const unknownFormat = errs({ format: 'colour' }, '#fff');
  eq('an unsupported format is an error', unknownFormat.length, 1);
  eq('and names the keyword', unknownFormat[0].keyword, 'format');
}

section('arrays and objects');
{
  check('items', !ok({ type: 'array', items: { type: 'string' } }, ['a', 2]));
  check('minItems', !ok({ type: 'array', minItems: 2 }, ['a']));
  check('maxItems', !ok({ type: 'array', maxItems: 1 }, ['a', 'b']));
  check('required', !ok({ type: 'object', required: ['id'] }, {}));
  check('property types', !ok({ type: 'object', properties: { id: { type: 'string' } } }, { id: 1 }));
  check('additionalProperties false rejects extras', !ok({ type: 'object', additionalProperties: false, properties: { id: {} } }, { id: 1, x: 2 }));
  check('additionalProperties schema validates extras', !ok({ type: 'object', additionalProperties: { type: 'string' } }, { x: 1 }));
  check('unknown properties allowed by default', ok({ type: 'object', properties: { id: {} } }, { id: 1, extra: true }));
  check('minProperties', !ok({ type: 'object', minProperties: 1 }, {}));
  check('minProperties satisfied', ok({ type: 'object', minProperties: 1 }, { a: 1 }));
  check('maxProperties', !ok({ type: 'object', maxProperties: 1 }, { a: 1, b: 2 }));

  const nested = schema.validate(
    { type: 'object', properties: { rows: { type: 'array', items: { type: 'object', required: ['w'] } } } },
    { rows: [{ w: 1 }, {}] }
  );
  eq('nested error is reported once', nested.errors.length, 1);
  eq('with an indexed path', nested.errors[0].path, '$.rows[1]');
  eq('and names the missing property', nested.errors[0].keyword, 'required');
}

section('combinators');
{
  check('allOf', !ok({ allOf: [{ type: 'string' }, { minLength: 5 }] }, 'abc'));
  check('anyOf', ok({ anyOf: [{ type: 'string' }, { type: 'null' }] }, null));
  check('anyOf none', !ok({ anyOf: [{ type: 'string' }, { type: 'number' }] }, true));

  const one = { oneOf: [{ type: 'number', minimum: 0 }, { type: 'number', maximum: 100 }] };
  check('oneOf match', ok(one, -5));
  const two = errs(one, 50);
  eq('oneOf reports double match', two[0].keyword, 'oneOf');
  check('oneOf mismatch', !ok(one, 'x'));

  check('not', !ok({ not: { type: 'string' } }, 'x'));
  check('not opposite', ok({ not: { type: 'string' } }, 1));
}

section('references');
{
  const root = {
    definitions: { status: { enum: ['PASS', 'FAIL', 'UNVERIFIED'] } },
    type: 'object',
    properties: { status: { $ref: '#/definitions/status' } },
  };
  check('local ref resolves', ok(root, { status: 'FAIL' }));
  check('local ref constrains', !ok(root, { status: 'DONE' }));
  const broken = schema.validate({ $ref: '#/definitions/missing' }, 1, { root: { definitions: {} } });
  eq('an unresolvable ref is an error', broken.errors[0].keyword, '$ref');

  const defs = { $defs: { path: { type: 'string', minLength: 1 } }, properties: { p: { $ref: '#/$defs/path' } } };
  check('$defs resolves', ok(defs, { p: 'a' }));
  check('$defs enforces', !ok(defs, { p: '' }));
}

section('a typo cannot disable a constraint');
{
  const bad = errs({ tpye: 'string' }, 'x');
  eq('unknown keyword is an error', bad[0].keyword, 'schema');
  check('and names it', /tpye/.test(bad[0].message), bad[0].message);
  const typo = errs({ type: 'string', tpye: 'number' }, 'x');
  eq('the value would otherwise pass, but the typo still fails it', typo.length, 1);
  check('the schema is invalid rather than silently permissive', !schema.validate({ type: 'string', tpye: 'number' }, 'x').valid);
}

section('assertValid throws a typed error');
{
  throws('SCHEMA_INVALID', () => schema.assertValid({ type: 'string' }, 1, 'page id'), 'SCHEMA_INVALID');
  const e = (() => { try { schema.assertValid({ required: ['a'] }, {}, 'state'); } catch (x) { return x; } })();
  check('message names the subject', /state does not satisfy schema/.test(e.message), e.message);
  check('the raw errors ride along', Array.isArray(e.errors) && e.errors.length === 1);
  eq('formatErrors renders path and message', schema.formatErrors([{ path: '$.a', message: 'bad' }]), '$.a: bad');
}

section('booleans are legal schemas');
{
  check('true allows anything', ok(true, { any: 'thing' }));
  check('false allows nothing', !ok(false, null));
}

section('typeOf classifies the way the validator does');
{
  eq('integer', schema.typeOf(3), 'integer');
  eq('number', schema.typeOf(3.5), 'number');
  eq('array before object', schema.typeOf([]), 'array');
  eq('null is its own type', schema.typeOf(null), 'null');
}

finish('schema.test');
