'use strict'

var assert = require('node:assert');
var express = require('../');
var request = require('supertest');

describe('request timeout', function(){
  describe('app.set("request timeout", ms)', function(){
    it('should accept a positive finite number', function(){
      var app = express();
      app.set('request timeout', 1000);
      assert.strictEqual(app.get('request timeout'), 1000);
    })

    it('should accept 0 as explicit disable', function(){
      var app = express();
      app.set('request timeout', 0);
      assert.strictEqual(app.get('request timeout'), 0);
    })

    it('should accept false as explicit disable', function(){
      var app = express();
      app.set('request timeout', false);
      assert.strictEqual(app.get('request timeout'), false);
    })

    it('should throw TypeError for invalid values', function(){
      var app = express();
      var invalid = [-1, -100, NaN, Infinity, -Infinity, '100', 'foo', {}, [], null, undefined, true];

      invalid.forEach(function(val){
        assert.throws(function(){
          app.set('request timeout', val);
        }, TypeError, 'value: ' + String(val));
      });
    })

    it('should not store invalid values', function(){
      var app = express();

      try {
        app.set('request timeout', 'nope');
      } catch (err) {
        // ignore
      }

      assert.strictEqual(app.get('request timeout'), undefined);
    })
  })

  describe('express.timeout(ms)', function(){
    it('should be exposed on the express export', function(){
      assert.strictEqual(typeof express.timeout, 'function');
    })

    it('should throw TypeError for invalid values', function(){
      var invalid = [-1, NaN, Infinity, '100', {}, null, undefined, true];

      invalid.forEach(function(val){
        assert.throws(function(){
          express.timeout(val);
        }, TypeError, 'value: ' + String(val));
      });
    })

    it('should accept a positive number, 0, or false', function(){
      assert.strictEqual(typeof express.timeout(100), 'function');
      assert.strictEqual(typeof express.timeout(0), 'function');
      assert.strictEqual(typeof express.timeout(false), 'function');
    })
  })

  describe('when not set', function(){
    it('should not time out', function(done){
      var app = express();

      app.get('/', function(req, res){
        setTimeout(function(){
          res.send('hello');
        }, 80);
      });

      request(app)
        .get('/')
        .expect(200, 'hello', done);
    })
  })

  describe('when enabled', function(){
    it('should respond 503 with "Request Timeout" when the handler hangs', function(done){
      var app = express();
      app.set('request timeout', 40);

      app.get('/', function(req, res){
        // never responds
      });

      request(app)
        .get('/')
        .expect('Content-Type', 'text/plain; charset=utf-8')
        .expect(503, 'Request Timeout', done);
    })

    it('should time out a request stuck in a param callback', function(done){
      var app = express();
      app.set('request timeout', 40);

      app.param('id', function(req, res, next, id){
        // never calls next()
      });

      app.get('/user/:id', function(req, res){
        res.send('user');
      });

      request(app)
        .get('/user/42')
        .expect(503, 'Request Timeout', done);
    })

    it('should not throw or send again when a late handler responds', function(done){
      var app = express();
      app.set('request timeout', 40);

      app.get('/', function(req, res){
        setTimeout(function(){
          res.send('too late');
          res.json({ late: true });
          res.end('again');
        }, 90);
      });

      request(app)
        .get('/')
        .expect(503, 'Request Timeout', done);
    })

    it('should swallow errors after the request timed out', function(done){
      var app = express();
      app.set('request timeout', 40);

      app.get('/', function(req, res, next){
        setTimeout(function(){
          next(new Error('boom'));
        }, 90);
      });

      request(app)
        .get('/')
        .expect(503, 'Request Timeout', done);
    })

    it('should be a no-op when headers are already sent', function(done){
      var app = express();
      app.set('request timeout', 40);

      app.get('/', function(req, res){
        res.write('hel');
        setTimeout(function(){
          res.end('lo');
        }, 90);
      });

      request(app)
        .get('/')
        .expect(200, 'hello', done);
    })

    it('should not time out a request that responds in time', function(done){
      var app = express();
      app.set('request timeout', 200);

      app.get('/', function(req, res){
        setTimeout(function(){
          res.send('fast');
        }, 30);
      });

      request(app)
        .get('/')
        .expect(200, 'fast', done);
    })
  })

  describe('express.timeout() middleware', function(){
    it('should enable a timeout for a single route', function(done){
      var app = express();

      app.get('/slow', express.timeout(40), function(req, res){
        // never responds
      });

      request(app)
        .get('/slow')
        .expect(503, 'Request Timeout', done);
    })

    it('should override the app-level timeout', function(done){
      var app = express();
      app.set('request timeout', 500);

      app.get('/slow', express.timeout(40), function(req, res){
        // never responds
      });

      request(app)
        .get('/slow')
        .expect(503, 'Request Timeout', done);
    })

    it('should extend the app-level timeout', function(done){
      var app = express();
      app.set('request timeout', 40);

      app.get('/slow', express.timeout(300), function(req, res){
        setTimeout(function(){
          res.send('made it');
        }, 90);
      });

      request(app)
        .get('/slow')
        .expect(200, 'made it', done);
    })

    it('should disable the app-level timeout with 0', function(done){
      var app = express();
      app.set('request timeout', 40);

      app.get('/slow', express.timeout(0), function(req, res){
        setTimeout(function(){
          res.send('made it');
        }, 90);
      });

      request(app)
        .get('/slow')
        .expect(200, 'made it', done);
    })

    it('should disable the app-level timeout with false', function(done){
      var app = express();
      app.set('request timeout', 40);

      app.get('/slow', express.timeout(false), function(req, res){
        setTimeout(function(){
          res.send('made it');
        }, 90);
      });

      request(app)
        .get('/slow')
        .expect(200, 'made it', done);
    })

    it('should apply the last middleware executed for the request', function(done){
      var app = express();

      app.use(express.timeout(500));
      app.get('/slow', express.timeout(40), function(req, res){
        // never responds
      });

      request(app)
        .get('/slow')
        .expect(503, 'Request Timeout', done);
    })

    it('should not affect other requests', function(done){
      var app = express();

      app.get('/slow', express.timeout(40), function(req, res){
        // never responds
      });

      app.get('/normal', function(req, res){
        setTimeout(function(){
          res.send('ok');
        }, 90);
      });

      request(app)
        .get('/slow')
        .expect(503, 'Request Timeout', function(err){
          if (err) return done(err);
          request(app)
            .get('/normal')
            .expect(200, 'ok', done);
        });
    })
  })

  describe('mounted sub-apps', function(){
    it('should inherit the parent timeout when the child does not set it', function(done){
      var app = express();
      var child = express();

      app.set('request timeout', 40);

      child.get('/hang', function(req, res){
        // never responds
      });

      app.use('/sub', child);

      request(app)
        .get('/sub/hang')
        .expect(503, 'Request Timeout', done);
    })

    it('should let the child override the parent timeout', function(done){
      var app = express();
      var child = express();

      app.set('request timeout', 500);
      child.set('request timeout', 40);

      child.get('/hang', function(req, res){
        // never responds
      });

      app.use('/sub', child);

      request(app)
        .get('/sub/hang')
        .expect(503, 'Request Timeout', done);
    })

    it('should let the child disable the parent timeout with 0', function(done){
      var app = express();
      var child = express();

      app.set('request timeout', 40);
      child.set('request timeout', 0);

      child.get('/slow', function(req, res){
        setTimeout(function(){
          res.send('made it');
        }, 90);
      });

      app.use('/sub', child);

      request(app)
        .get('/sub/slow')
        .expect(200, 'made it', done);
    })

    it('should let the child disable the parent timeout with false', function(done){
      var app = express();
      var child = express();

      app.set('request timeout', 40);
      child.set('request timeout', false);

      child.get('/slow', function(req, res){
        setTimeout(function(){
          res.send('made it');
        }, 90);
      });

      app.use('/sub', child);

      request(app)
        .get('/sub/slow')
        .expect(200, 'made it', done);
    })

    it('should keep the parent timeout for requests outside the child', function(done){
      var app = express();
      var child = express();

      app.set('request timeout', 40);
      child.set('request timeout', 0);

      child.get('/slow', function(req, res){
        setTimeout(function(){
          res.send('made it');
        }, 90);
      });

      app.get('/hang', function(req, res){
        // never responds
      });

      app.use('/sub', child);

      request(app)
        .get('/hang')
        .expect(503, 'Request Timeout', done);
    })

    it('should honor a child timeout shorter than the parent remaining time', function(done){
      var app = express();
      var child = express();

      app.set('request timeout', 5000);
      child.set('request timeout', 40);

      child.get('/hang', function(req, res){
        // never responds
      });

      app.use('/sub', child);

      request(app)
        .get('/sub/hang')
        .expect(503, 'Request Timeout', done);
    })
  })
})
