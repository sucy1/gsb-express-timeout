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

var debug = require('debug')('express:timeout');

/**
 * Module exports.
 * @public
 */

exports = module.exports = timeout;
exports.guard = guardDone;
exports.set = setRequestTimeout;
exports.validate = validateTimeout;

/**
 * Key used to store the per-request timeout state.
 * @private
 */

var requestTimeoutStateSymbol = '@@symbol:request_timeout_state';

/**
 * Response body sent when a request times out.
 * @private
 */

var TIMEOUT_BODY = 'Request Timeout';

/**
 * Create a middleware that resets the active request timeout
 * to `ms` milliseconds for the remainder of the request.
 *
 * A value of `0` or `false` cancels the active timeout.
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
 * Validate a request timeout value.
 *
 * A positive finite number of milliseconds enables the timeout,
 * while `0` or `false` explicitly disables it. Anything else
 * throws a `TypeError`.
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
 * Wrap a final `done` callback so that completion of a timed out
 * request is ignored and never reaches the final handler.
 *
 * @param {Function} done
 * @param {Object} req
 * @return {Function}
 * @private
 */

function guardDone(done, req) {
  return function guardedDone(err) {
    var state = req[requestTimeoutStateSymbol];

    if (state && state.timedOut) {
      debug('ignoring completion of timed out request');
      return;
    }

    return done.apply(this, arguments);
  };
}

/**
 * Reset the active request timeout to `ms` milliseconds.
 *
 * Clears any previously active timer first, so that a request
 * never has more than one active timer. A value of `0` or
 * `false` cancels the active timeout.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {Number|Boolean} ms
 * @private
 */

function setRequestTimeout(req, res, ms) {
  var state = req[requestTimeoutStateSymbol];

  if (!state) {
    if (ms === 0 || ms === false) {
      return;
    }

    state = createState(req, res);
  }

  clearTimer(state);

  if (state.timedOut || ms === 0 || ms === false) {
    return;
  }

  var timer = state.timer = setTimeout(function ontimeout() {
    state.timer = null;
    onRequestTimeout(state);
  }, ms);

  timer.unref();
}

/**
 * Create the per-request timeout state and ensure the active
 * timer is cleared once the response finishes or closes.
 *
 * @param {Object} req
 * @param {Object} res
 * @return {Object}
 * @private
 */

function createState(req, res) {
  var state = {
    timer: null,
    timedOut: false,
    res: res
  };

  Object.defineProperty(req, requestTimeoutStateSymbol, {
    configurable: true,
    writable: true,
    value: state
  });

  function clear() {
    clearTimer(state);
  }

  res.once('close', clear);
  res.once('finish', clear);

  return state;
}

/**
 * Clear the active timer of the given state, if any.
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
 * Handle expiration of the request timeout.
 *
 * Responds with a 503 "Request Timeout" when the response has
 * not started yet, otherwise does nothing. Once timed out, the
 * response is sealed so further writes are silently ignored.
 *
 * @param {Object} state
 * @private
 */

function onRequestTimeout(state) {
  var res = state.res;

  if (state.timedOut || res.headersSent) {
    return;
  }

  state.timedOut = true;

  debug('request timed out, responding 503');

  res.statusCode = 503;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.end(TIMEOUT_BODY);

  sealResponse(res);
}

/**
 * Seal a timed out response so that further attempts to write
 * to it are silently ignored instead of throwing or producing
 * a second response.
 *
 * @param {Object} res
 * @private
 */

function sealResponse(res) {
  res.send = sealedSend;
  res.json = sealedSend;
  res.jsonp = sealedSend;
  res.write = sealedWrite;
  res.end = sealedEnd;
  res.setHeader = sealedSetHeader;
  res.writeHead = sealedWriteHead;
}

/**
 * No-op replacements used on sealed responses.
 * @private
 */

function sealedSend() {
  return this;
}

function sealedWrite() {
  return false;
}

function sealedEnd() {
  return this;
}

function sealedSetHeader() {
  return this;
}

function sealedWriteHead() {
  return this;
}
