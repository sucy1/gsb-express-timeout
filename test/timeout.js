'use strict'

var assert = require('node:assert');
var express = require('..');
var request = require('supertest');

describe('request timeout', function () {
  describe('app.set("request timeout", ms)', function () {
    it('should default to undefined (disabled)', function () {
      var app = express();
      assert.strictEqual(app.get('request timeout'), undefined);
    })

    it('should accept a positive finite number', function () {
      var app = express();
      app.set('request timeout', 100);
      assert.strictEqual(app.get('request timeout'), 100);
    })

    it('should accept 0 as explicit disable', function () {
      var app = express();
      app.set('request timeout', 0);
      assert.strictEqual(app.get('request timeout'), 0);
    })

    it('should accept false as explicit disable', function () {
      var app = express();
      app.set('request timeout', false);
      assert.strictEqual(app.get('request timeout'), false);
    })

    it('should throw TypeError for invalid values', function () {
      var app = express();
      var invalid = [-1, -100, NaN, Infinity, -Infinity, '100', 'foo', {}, [], null, undefined, true];

      invalid.forEach(function (val) {
        assert.throws(function () {
          app.set('request timeout', val);
        }, TypeError, 'expected TypeError for ' + String(val));
      })
    })

    it('should not store invalid values', function () {
      var app = express();
      app.set('request timeout', 100);
      assert.throws(function () {
        app.set('request timeout', 'nope');
      }, TypeError);
      assert.strictEqual(app.get('request timeout'), 100);
    })
  })

  describe('express.timeout(ms)', function () {
    it('should be exposed on the express export', function () {
      assert.strictEqual(typeof express.timeout, 'function');
    })

    it('should return a middleware function', function () {
      assert.strictEqual(typeof express.timeout(100), 'function');
    })

    it('should throw TypeError for invalid values at creation', function () {
      [-1, NaN, Infinity, '100', {}, null, undefined, true].forEach(function (val) {
        assert.throws(function () {
          express.timeout(val);
        }, TypeError, 'expected TypeError for ' + String(val));
      })
    })

    it('should accept 0 and false', function () {
      assert.strictEqual(typeof express.timeout(0), 'function');
      assert.strictEqual(typeof express.timeout(false), 'function');
    })
  })

  describe('when enabled', function () {
    it('should respond 503 "Request Timeout" when the handler hangs', function (done) {
      var app = express();
      app.set('request timeout', 50);

      app.get('/', function (req, res) {
        // never responds
      })

      request(app)
        .get('/')
        .expect('Content-Type', 'text/plain; charset=utf-8')
        .expect(503, 'Request Timeout', done);
    })

    it('should time out a request stuck in a param callback', function (done) {
      var app = express();
      app.set('request timeout', 50);

      app.param('id', function (req, res, next, id) {
        // preloading hangs, next() never called
      })

      app.get('/user/:id', function (req, res) {
        res.send('user');
      })

      request(app)
        .get('/user/42')
        .expect(503, 'Request Timeout', done);
    })

    it('should ignore a late res.send after timeout', function (done) {
      var app = express();
      app.set('request timeout', 50);

      app.get('/', function (req, res) {
        setTimeout(function () {
          assert.doesNotThrow(function () {
            res.send('too late');
          })
        }, 150)
      })

      request(app)
        .get('/')
        .expect(503, 'Request Timeout', done);
    })

    it('should ignore a late res.json after timeout', function (done) {
      var app = express();
      app.set('request timeout', 50);

      app.get('/', function (req, res) {
        setTimeout(function () {
          assert.doesNotThrow(function () {
            res.json({ late: true });
          })
        }, 150)
      })

      request(app)
        .get('/')
        .expect(503, 'Request Timeout', done);
    })

    it('should ignore a late res.end after timeout', function (done) {
      var app = express();
      app.set('request timeout', 50);

      app.get('/', function (req, res) {
        setTimeout(function () {
          assert.doesNotThrow(function () {
            res.end('too late');
          })
        }, 150)
      })

      request(app)
        .get('/')
        .expect(503, 'Request Timeout', done);
    })

    it('should not let a late next(err) produce an error response', function (done) {
      var app = express();
      app.set('request timeout', 50);

      app.get('/', function (req, res, next) {
        setTimeout(function () {
          next(new Error('boom'));
        }, 150)
      })

      request(app)
        .get('/')
        .expect(503, 'Request Timeout', done);
    })

    it('should not time out when the response is sent in time', function (done) {
      var app = express();
      app.set('request timeout', 200);

      app.get('/', function (req, res) {
        setTimeout(function () {
          res.send('ok');
        }, 50)
      })

      request(app)
        .get('/')
        .expect(200, 'ok', done);
    })

    it('should be a no-op once response headers are sent', function (done) {
      var app = express();
      app.set('request timeout', 50);

      app.get('/', function (req, res) {
        res.write('partial');
        setTimeout(function () {
          res.end('done');
        }, 150)
      })

      request(app)
        .get('/')
        .expect(200, 'partialdone', done);
    })
  })

  describe('when not set', function () {
    it('should not time out hanging-free slow requests', function (done) {
      var app = express();

      app.get('/', function (req, res) {
        setTimeout(function () {
          res.send('slow but fine');
        }, 150)
      })

      request(app)
        .get('/')
        .expect(200, 'slow but fine', done);
    })
  })

  describe('express.timeout() middleware', function () {
    it('should enable a timeout for a single route', function (done) {
      var app = express();

      app.get('/slow', express.timeout(50), function (req, res) {
        // never responds
      })

      request(app)
        .get('/slow')
        .expect(503, 'Request Timeout', done);
    })

    it('should override the app-level timeout', function (done) {
      var app = express();
      app.set('request timeout', 50);

      app.get('/slow', express.timeout(500), function (req, res) {
        setTimeout(function () {
          res.send('ok');
        }, 150)
      })

      request(app)
        .get('/slow')
        .expect(200, 'ok', done);
    })

    it('should disable the app-level timeout with 0', function (done) {
      var app = express();
      app.set('request timeout', 50);

      app.get('/slow', express.timeout(0), function (req, res) {
        setTimeout(function () {
          res.send('ok');
        }, 150)
      })

      request(app)
        .get('/slow')
        .expect(200, 'ok', done);
    })

    it('should disable the app-level timeout with false', function (done) {
      var app = express();
      app.set('request timeout', 50);

      app.use(express.timeout(false));

      app.get('/slow', function (req, res) {
        setTimeout(function () {
          res.send('ok');
        }, 150)
      })

      request(app)
        .get('/slow')
        .expect(200, 'ok', done);
    })

    it('should apply the last middleware executed before the handler', function (done) {
      var app = express();

      app.get('/slow',
        express.timeout(50),
        express.timeout(500),
        function (req, res) {
          setTimeout(function () {
            res.send('ok');
          }, 150)
        })

      request(app)
        .get('/slow')
        .expect(200, 'ok', done);
    })

    it('should not affect other requests', function (done) {
      var app = express();

      app.get('/a', express.timeout(50), function (req, res) {
        // never responds
      })

      app.get('/b', function (req, res) {
        setTimeout(function () {
          res.send('b ok');
        }, 150)
      })

      request(app)
        .get('/a')
        .expect(503, 'Request Timeout', function (err) {
          if (err) return done(err);
          request(app)
            .get('/b')
            .expect(200, 'b ok', done);
        });
    })
  })

  describe('mounted sub-apps', function () {
    it('should inherit the parent timeout when the child does not set one', function (done) {
      var app = express();
      var child = express();

      app.set('request timeout', 50);

      child.get('/', function (req, res) {
        // never responds
      })

      app.use('/sub', child);

      request(app)
        .get('/sub/')
        .expect(503, 'Request Timeout', done);
    })

    it('should let the child override the parent timeout', function (done) {
      var app = express();
      var child = express();

      app.set('request timeout', 50);
      child.set('request timeout', 500);

      child.get('/', function (req, res) {
        setTimeout(function () {
          res.send('child ok');
        }, 150)
      })

      app.use('/sub', child);

      request(app)
        .get('/sub/')
        .expect(200, 'child ok', done);
    })

    it('should let the child shorten the parent timeout', function (done) {
      var app = express();
      var child = express();

      app.set('request timeout', 5000);
      child.set('request timeout', 50);

      child.get('/', function (req, res) {
        // never responds
      })

      app.use('/sub', child);

      request(app)
        .get('/sub/')
        .expect(503, 'Request Timeout', done);
    })

    it('should let the child disable the parent timeout with 0', function (done) {
      var app = express();
      var child = express();

      app.set('request timeout', 50);
      child.set('request timeout', 0);

      child.get('/', function (req, res) {
        setTimeout(function () {
          res.send('child ok');
        }, 150)
      })

      app.use('/sub', child);

      request(app)
        .get('/sub/')
        .expect(200, 'child ok', done);
    })

    it('should let the child disable the parent timeout with false', function (done) {
      var app = express();
      var child = express();

      app.set('request timeout', 50);
      child.set('request timeout', false);

      child.get('/', function (req, res) {
        setTimeout(function () {
          res.send('child ok');
        }, 150)
      })

      app.use('/sub', child);

      request(app)
        .get('/sub/')
        .expect(200, 'child ok', done);
    })

    it('should let the child enable a timeout when the parent has none', function (done) {
      var app = express();
      var child = express();

      child.set('request timeout', 50);

      child.get('/', function (req, res) {
        // never responds
      })

      app.use('/sub', child);

      request(app)
        .get('/sub/')
        .expect(503, 'Request Timeout', done);
    })

    it('should not produce a double response when parent and child both time out', function (done) {
      var app = express();
      var child = express();

      app.set('request timeout', 50);
      child.set('request timeout', 50);

      child.get('/', function (req, res) {
        setTimeout(function () {
          assert.doesNotThrow(function () {
            res.send('too late');
          })
        }, 200)
      })

      app.use('/sub', child);

      request(app)
        .get('/sub/')
        .expect(503, 'Request Timeout', done);
    })
  })
})
