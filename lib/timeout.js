/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */

var Buffer = require('node:buffer').Buffer;

/**
 * Key used to store the per-request timeout state.
 * @private
 */

var stateSymbol = '@@symbol:request_timeout_state';

/**
 * Validate a timeout value.
 *
 * A positive finite number enables the timeout, while 0 or false
 * explicitly disables it. Anything else is a TypeError.
 *
 * @param {*} ms
 * @private
 */

function validateTimeout(ms) {
  if (ms === 0 || ms === false) {
    return;
  }

  if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) {
    throw new TypeError('request timeout must be a positive finite number of milliseconds, 0, or false');
  }
}

/**
 * Get or create the timeout state for a request.
 *
 * @param {IncomingMessage} req
 * @return {Object}
 * @private
 */

function getState(req) {
  var state = req[stateSymbol];

  if (!state) {
    state = req[stateSymbol] = {
      timer: null,
      timedOut: false,
      listening: false
    };
  }

  return state;
}

/**
 * Clear the active timer of a request, if any.
 *
 * @param {Object} state
 * @private
 */

function clearTimer(state) {
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
  }
}

/**
 * Silence a response after the request timed out.
 *
 * Subsequent res.send()/res.json()/res.end() calls become harmless
 * no-ops so a late handler cannot throw, write a second response,
 * or overwrite the 503 response already sent.
 *
 * @param {ServerResponse} res
 * @private
 */

function silenceResponse(res) {
  res.write = function write() {
    return false;
  };

  res.end = function end(chunk, encoding, callback) {
    var cb = typeof chunk === 'function'
      ? chunk
      : typeof encoding === 'function'
        ? encoding
        : callback;

    if (typeof cb === 'function') {
      cb();
    }

    return this;
  };

  res.send = function send() {
    return this;
  };

  res.json = function json() {
    return this;
  };

  res.jsonp = function jsonp() {
    return this;
  };
}

/**
 * Handle a request timeout expiring.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {Object} state
 * @private
 */

function onTimeout(req, res, state) {
  state.timer = null;

  // response already underway; treat as a no-op
  if (res.headersSent) {
    return;
  }

  state.timedOut = true;

  var body = 'Request Timeout';

  res.statusCode = 503;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(body));
  res.end(body);

  silenceResponse(res);
}

/**
 * Set the active timeout of a request, replacing any previous one.
 *
 * At most one timer is active per request at any time. A value of
 * 0 or false cancels the active timeout for the rest of the request.
 *
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @param {Number|Boolean} ms
 * @private
 */

function setRequestTimeout(req, res, ms) {
  var state = getState(req);

  clearTimer(state);

  if (state.timedOut || ms === 0 || ms === false) {
    return;
  }

  // clear the timer once the response finishes or closes
  if (!state.listening) {
    state.listening = true;

    var ondone = function ondone() {
      clearTimer(state);
    };

    res.on('finish', ondone);
    res.on('close', ondone);
  }

  state.timer = setTimeout(function ontimeout() {
    onTimeout(req, res, state);
  }, ms);

  // do not keep the process alive for this timer
  state.timer.unref();
}

/**
 * Apply an application's "request timeout" setting to a request.
 *
 * Only applies when the application explicitly set the setting;
 * otherwise any active timeout inherited from a parent application
 * is left untouched.
 *
 * @param {Object} app
 * @param {IncomingMessage} req
 * @param {ServerResponse} res
 * @private
 */

function initRequestTimeout(app, req, res) {
  if (app.settings['@@symbol:request_timeout_default'] === true) {
    // setting not explicitly set on this app; inherit active timeout
    return;
  }

  setRequestTimeout(req, res, app.settings['request timeout']);
}

/**
 * Wrap a final "done" callback so that errors raised after the
 * request timed out are swallowed instead of reaching the default
 * error handler.
 *
 * @param {IncomingMessage} req
 * @param {Function} done
 * @return {Function}
 * @private
 */

function wrapDone(req, done) {
  return function wrappedDone(err) {
    var state = req[stateSymbol];

    if (state && state.timedOut) {
      return;
    }

    return done(err);
  };
}

/**
 * Create a middleware that resets the active timeout of the current
 * request to `ms` milliseconds (0 or false disables it).
 *
 * @param {Number|Boolean} ms
 * @return {Function}
 * @public
 */

function timeout(ms) {
  validateTimeout(ms);

  return function requestTimeout(req, res, next) {
    setRequestTimeout(req, res, ms);
    next();
  };
}

/**
 * Module exports.
 */

exports = module.exports = timeout;
exports.initRequestTimeout = initRequestTimeout;
exports.validateTimeout = validateTimeout;
exports.wrapDone = wrapDone;
