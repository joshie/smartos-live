/*
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * mocks for tests
 */

var fw;
var mockery = require('mockery');
var mod_obj = require('../../lib/util/obj');

var createSubObjects = mod_obj.createSubObjects;



// --- Globals



var IPF = '/usr/sbin/ipf';
var VALUES = {};
var LOG = false;



// --- Internal helper functions



function _ENOENT(path) {
  var err = new Error('ENOENT: ' + path);
  err.code = 'ENOENT';
  return err;
}


function _splitFile(f) {
  return {
    dir: f.substring(0, f.lastIndexOf('/')),
    file: f.substring(f.lastIndexOf('/') + 1)
  };
}



// --- bunyan



function _log(level, args) {
  if (args.length !== 0) {
    VALUES.bunyan[level].push(args);
    if (LOG) {
      console.error('# %s %j', level, args);
    }
  }
  return true;
}


function createLogger() {
  return {
    trace: function () { return _log('trace', arguments); },
    debug: function () { return _log('debug', arguments); },
    error: function () { return _log('error', arguments); },
    warn: function () { return _log('warn', arguments); },
    info: function () { return _log('info', arguments); }
  };
}

function errSerializer(err) {
  return err;
}


function mockRingBuffer(opts) {
  this.opts = opts;
}



// --- child_process



/**
 * Record the IPF state for a zone, keeping track of whether it's enabled,
 * and what's in the active and inactive lists.
 */
function _recordIPFstate(args) {
  var zone = createSubObjects(VALUES.ipf, args[args.length - 1]);

  if (args[0] == '-D') {
    zone.enabled = false;
    zone.inactive = '';
    zone.active = '';
    return;
  }

  if (args[0] == '-E') {
    zone.enabled = true;
    zone.inactive = '';
    zone.active = '';
    return;
  }

  if (args[0] == '-IFa') {
    zone.inactive = '';
    return;
  }

  if (args[0] == '-s') {
    var active = zone.active || '';
    var inactive = zone.inactive || '';
    zone.active = inactive;
    zone.inactive = active;
    return;
  }

  if (args[0] == '-I' && args[1] == '-f') {
    var root = VALUES.fs;
    var p = _splitFile(args[2]);
    if (!root.hasOwnProperty(p.dir)
        || !root[p.dir].hasOwnProperty(p.file)) {
      throw _ENOENT(p.file);
    }

    zone.inactive = root[p.dir][p.file];
    return;
  }
}


function execFile(path, args, cb) {
  var vals = VALUES.child_process[path];
  if (!vals) {
    vals = {
      err: new Error('Uh-oh'),
      stderr: null,
      stdout: null
    };
  }

  // console.log('> execFile: %s %s', path, args.join(' '));
  if (path == IPF) {
    try {
      _recordIPFstate(args);
    } catch (err) {
      vals.err = err;
    }
  }

  return cb(vals.err, vals.stdout, vals.stderr);
}



// --- fs



function readDir(dir, cb) {
  var root = VALUES.fs;
  if (!root.hasOwnProperty(dir)) {
    return cb(_ENOENT(dir));
  }

  return cb(null, Object.keys(root[dir]));
}


function readFile(file, cb) {
  var p = _splitFile(file);
  var root = VALUES.fs;

  if (!root.hasOwnProperty(p.dir)
      || !root[p.dir].hasOwnProperty(p.file)) {
    return cb(_ENOENT(file));
  }

  return cb(null, root[p.dir][p.file]);
}


function rename(before, after, cb) {
  readFile(before, function (err, res) {
    if (err) {
      return cb(err);
    }

    writeFile(after, res, function (err2, res2) {
      if (err2) {
        return cb(err2);
      }

      return unlink(before, cb);
    });
  });
}


function unlink(file, cb) {
  var p = _splitFile(file);
  var root = VALUES.fs;

  if (!root.hasOwnProperty(p.dir)
      || !root[p.dir].hasOwnProperty(p.file)) {
    return cb(_ENOENT(file));
  }

  delete root[p.dir][p.file];
  return cb();
}


function writeFile(f, data, cb) {
  // TODO: be able to return an error here
  var p = _splitFile(f);

  var root = VALUES.fs;
  if (!root.hasOwnProperty(p.dir)) {
    root[p.dir] = {};
  }

  root[p.dir][p.file] = data;
  return cb();
}



// --- mkdirp



function mkdirp(dir, cb) {
  if (!VALUES.fs.hasOwnProperty(dir)) {
    VALUES.fs[dir] = {};
  }
  return cb();
}


mkdirp.sync = function mkdirpSync(dir) {
  if (!VALUES.fs.hasOwnProperty(dir)) {
    VALUES.fs[dir] = {};
  }
  return;
};



// --- Setup / Teardown



/**
 * Initialize VALUES to a clean state for each mock
 */
function resetValues() {
  VALUES = {};

  VALUES.bunyan = {
    trace: [],
    debug: [],
    error: [],
    warn: [],
    info: []
  };

  VALUES.child_process = {};
  VALUES.child_process[IPF] = {
    err: null,
    stderr: null,
    stdout: ['ipf: IP Filter: v4.1.9 (592)',
      'Kernel: IP Filter: v4.1.9',
      'Running: yes',
      'Log Flags: 0 = none set',
      'Default: nomatch -> block all, Logging: available',
      'Active list: 0',
      'Feature mask: 0x107'
    ].join('\n')
  };

  VALUES.fs = {};

  VALUES.ipf = {};
}


/**
 * Enable all of the mocks, and initialize VALUES. Returns a newly-require()'d
 * fw.js with most external modules mocked out.
 */
function setup() {
  if (fw) {
    return fw;
  }

  resetValues();
  mockery.enable();
  var modules = {
    '/usr/node/node_modules/bunyan': {
      createLogger: createLogger,
      RingBuffer: mockRingBuffer,
      stdSerializers: {
        err: errSerializer
      }
    },
    child_process: {
      execFile: execFile
    },
    fs: {
      readdir: readDir,
      readFile: readFile,
      rename: rename,
      unlink: unlink,
      writeFile: writeFile
    },
    mkdirp: mkdirp,
    path: {
    }
  };

  for (var m in modules) {
    mockery.registerMock(m, modules[m]);
  }

  [
    'assert',
    'assert-plus',
    'clone',
    'extsprintf',
    'fwrule',
    'node-uuid',
    'net',
    'stream',
    'vasync',
    'verror',
    'util',
    './clonePrototype.js',
    './ipf',
    './obj',
    './parser',
    './pipeline',
    './rule',
    './util/log',
    './util/obj',
    './util/vm',
    './validators',
    '../../lib/fw'
  ].forEach(function (mod) {
    mockery.registerAllowable(mod);
  });

  fw = require('../../lib/fw');
  return fw;
}


/**
 * Disable all of the mocks
 */
function teardown() {
  mockery.disable();
}



// --- Exports



module.exports = {
  reset: resetValues,
  setup: setup,
  teardown: teardown
};

module.exports.__defineGetter__('values', function () {
  return VALUES;
});
