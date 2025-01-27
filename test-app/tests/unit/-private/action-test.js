import { module, test } from 'qunit';
import { create } from 'ember-cli-page-object';
import action from 'ember-cli-page-object/-private/action';
import { isPageObject } from 'ember-cli-page-object/-private/meta';
import { setAdapter, getAdapter } from 'ember-cli-page-object/adapters';
import Adapter from 'ember-cli-page-object/adapter';

class DummyAdapter extends Adapter {}

function assertThrowsErrorMessage(
  assert,
  block,
  expectedMessage,
  asserionMessage
) {
  try {
    block();
    assert.true(false);
  } catch (e) {
    assert.strictEqual(e.toString(), expectedMessage, asserionMessage);
  }
}

// Normally it should work with "0".
// However, since Promises are not supported in IE11, for async we rely on "RSVP" library,
// Unfortunatelly, for some of old "ember" versions there are timing lags coming from "RSVP",
// so we use a value larger than "0" to appease out test matrix.
const DEFAULT_NEXT_TICK_TIMEOUT = 20;

const next = (timeout = DEFAULT_NEXT_TICK_TIMEOUT) => {
  return new Promise((r) => setTimeout(r, timeout));
};

class Deferred {
  constructor() {
    this.promise = new Promise(
      function (resolve, reject) {
        this.resolve = resolve;
        this.reject = reject;
      }.bind(this)
    );

    Object.freeze(this);
  }
}

module('Unit | action', function (hooks) {
  let initialAdapter;

  hooks.beforeEach(function () {
    initialAdapter = getAdapter();

    setAdapter(new DummyAdapter());
  });

  hooks.afterEach(function () {
    setAdapter(initialAdapter);
  });

  let invoked, finished, node;

  const testable = (query) => {
    return action(query, function (id, deferred) {
      invoked.push(id);
      node = this;

      return deferred.promise.then(() => {
        finished.push(id);
      });
    });
  };

  hooks.beforeEach(function () {
    invoked = [];
    finished = [];
    node = null;
  });

  test('it works', async function (assert) {
    const p = create({
      scope: 'it works',

      run: testable({ selector: '.Selector' }),
    });

    const d1 = new Deferred();
    p.run(1, d1);

    assert.true(typeof node === 'object' && node !== null);
    assert.equal(node, p, '');

    assert.deepEqual(invoked, [1]);
    assert.deepEqual(finished, []);

    await d1.resolve();

    assert.deepEqual(invoked, [1]);
    assert.deepEqual(finished, [1]);
  });

  test('it handles sync errors', async function (assert) {
    const p = create({
      scope: '.Scope',

      run: action({ selector: '.Selector' }, function () {
        throw new Error('it was so fast!');
      }),
    });

    assertThrowsErrorMessage(
      assert,
      () => p.run(1),
      `Error: it was so fast!

PageObject: 'page.run("1")'
  Selector: '.Scope .Selector'`
    );
  });

  test('it handles sync errors w/o query', async function (assert) {
    const p = create({
      scope: '.Scope',

      run: action(function () {
        throw new Error('it was so fast!');
      }),
    });

    assertThrowsErrorMessage(
      assert,
      () => p.run(1),
      `Error: it was so fast!

PageObject: 'page.run("1")'
  Selector: '.Scope'`
    );
  });

  test('it handles async errors', async function (assert) {
    const p = create({
      scope: '.Scope',

      run: action({ selector: '.Selector' }, function () {
        return next().then(() => {
          throw new Error('bed time');
        });
      }),
    });

    return p.run(1).then(
      () => {
        assert.true(false);
      },
      (e) => {
        assert.strictEqual(
          e.toString(),
          `Error: bed time

PageObject: 'page.run("1")'\n  Selector: '.Scope .Selector'`
        );
      }
    );
  });

  module('chainability', function () {
    test('it works', async function (assert) {
      const p = create({
        scope: '.root',

        run: testable({ selector: '.Selector1' }),

        child: {
          scope: '.child',

          run: testable({ selector: '.Selector2' }),
        },
      });

      const d1 = new Deferred();
      const running1 = p.run(1, d1);
      assert.equal(isPageObject(running1), true);
      assert.notStrictEqual(running1, p);
      assert.equal(running1.scope, '.root');
      assert.deepEqual(invoked, [1]);
      assert.deepEqual(finished, []);

      const d2 = new Deferred();
      const running2 = running1.run(2, d2);
      assert.strictEqual(running1, running2);
      assert.deepEqual(invoked, [1]);
      assert.deepEqual(finished, []);

      const d3 = new Deferred();
      const running3 = running2.child.run(3, d3);
      assert.equal(isPageObject(running3), true);
      assert.notStrictEqual(running1, running3);
      assert.equal(running3.scope, '.child');
      assert.deepEqual(invoked, [1]);
      assert.deepEqual(finished, []);

      d1.resolve();
      await next();

      assert.deepEqual(invoked, [1, 2]);
      assert.deepEqual(finished, [1]);

      d2.resolve();
      await next();

      assert.deepEqual(invoked, [1, 2, 3]);
      assert.deepEqual(finished, [1, 2]);

      await d3.resolve();
      assert.deepEqual(invoked, [1, 2, 3]);
      assert.deepEqual(finished, [1, 2, 3]);
    });

    test('concurrent from same root', async function (assert) {
      const p = create({
        scope: '.root',

        run: testable({ selector: '.Selector1' }),
      });

      const d1 = new Deferred();
      const running1 = p.run('1', d1);
      assert.equal(isPageObject(running1), true);
      assert.notStrictEqual(running1, p);
      assert.equal(running1.scope, '.root');
      assert.deepEqual(invoked, ['1']);
      assert.deepEqual(finished, []);

      const d11 = new Deferred();
      const running11 = p.run('1.1', d11);
      assert.strictEqual(running1, running11);
      assert.deepEqual(invoked, ['1', '1.1']);
      assert.deepEqual(finished, []);

      const d12 = new Deferred();
      const running12 = p.run('1.2', d12);
      assert.strictEqual(running1, running12);
      assert.deepEqual(invoked, ['1', '1.1', '1.2']);
      assert.deepEqual(finished, []);

      d1.resolve();
      assert.deepEqual(invoked, ['1', '1.1', '1.2']);
      assert.deepEqual(finished, []);

      await next();
      assert.deepEqual(finished, ['1']);

      d12.resolve();
      assert.deepEqual(finished, ['1']);

      await next();
      assert.deepEqual(finished, ['1', '1.2']);

      d11.resolve();
      assert.deepEqual(finished, ['1', '1.2']);

      await next();
      assert.deepEqual(finished, ['1', '1.2', '1.1']);
    });

    test('concurrent from same chain root', async function (assert) {
      const p = create({
        scope: '.root',

        run: testable({ selector: '.Selector1' }),
      });

      const d1 = new Deferred();
      const running1 = p.run('1', d1);
      assert.equal(isPageObject(running1), true);
      assert.notStrictEqual(running1, p);
      assert.equal(running1.scope, '.root');
      assert.deepEqual(invoked, ['1']);
      assert.deepEqual(finished, []);

      const d11 = new Deferred();
      const running11 = running1.run('1.1', d11);
      assert.strictEqual(running1, running11);
      assert.deepEqual(invoked, ['1']);
      assert.deepEqual(finished, []);

      const d12 = new Deferred();
      const running12 = running1.run('1.2', d12);
      assert.strictEqual(running1, running12);
      assert.deepEqual(invoked, ['1']);
      assert.deepEqual(finished, []);

      d1.resolve();
      assert.deepEqual(invoked, ['1']);
      assert.deepEqual(finished, []);

      await next();
      assert.deepEqual(invoked, ['1', '1.1']);
      assert.deepEqual(finished, ['1']);

      await next();
      assert.deepEqual(invoked, ['1', '1.1']);
      assert.deepEqual(finished, ['1']);

      d12.resolve();
      assert.deepEqual(invoked, ['1', '1.1']);
      assert.deepEqual(finished, ['1']);

      await next();
      assert.deepEqual(invoked, ['1', '1.1']);
      assert.deepEqual(finished, ['1']);

      d11.resolve();
      assert.deepEqual(invoked, ['1', '1.1']);
      assert.deepEqual(finished, ['1']);

      await next();
      assert.deepEqual(invoked, ['1', '1.1', '1.2']);
      assert.deepEqual(finished, ['1', '1.1', '1.2']);
    });

    test('it handles errors', async function (assert) {
      const p = create({
        scope: '.root',

        emptyRun: action({ selector: '.Selector1' }, () => {}),

        child: {
          scope: '.child',

          run: action({ selector: '.Selector2' }, function () {
            return next().then(() => {
              throw new Error('bed time');
            });
          }),
        },
      });

      return p
        .emptyRun()
        .child.run(1)
        .then(
          () => {
            assert.true(false);
          },
          (e) => {
            assert.strictEqual(
              e.toString(),
              `Error: bed time

PageObject: 'page.child.run("1")'\n  Selector: '.root .child .Selector2'`
            );
          }
        );
    });
  });
});
