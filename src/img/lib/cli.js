/*
 * CDDL HEADER START
 *
 * The contents of this file are subject to the terms of the
 * Common Development and Distribution License, Version 1.0 only
 * (the "License").  You may not use this file except in compliance
 * with the License.
 *
 * You can obtain a copy of the license at http://smartos.org/CDDL
 *
 * See the License for the specific language governing permissions
 * and limitations under the License.
 *
 * When distributing Covered Code, include this CDDL HEADER in each
 * file.
 *
 * If applicable, add the following below this CDDL HEADER, with the
 * fields enclosed by brackets "[]" replaced with your own identifying
 * information: Portions Copyright [yyyy] [name of copyright owner]
 *
 * CDDL HEADER END
 *
 * Copyright (c) 2013, Joyent, Inc. All rights reserved.
 *
 * * *
 * The main entry point for an the imgadm CLI.
 */

var util = require('util'),
    format = util.format;
var warn = console.warn;
var child_process = require('child_process'),
    spawn = child_process.spawn,
    exec = child_process.exec;
var os = require('os');
var path = require('path');
var fs = require('fs');
var assert = require('assert-plus');
var nopt = require('nopt');
var sprintf = require('extsprintf').sprintf;
var bunyan;
if (process.platform === 'sunos') {
    bunyan = require('/usr/node/node_modules/bunyan');
} else {
    bunyan = require('bunyan');
}

var imgadm = require('./imgadm');
var common = require('./common'),
    objCopy = common.objCopy,
    NAME = common.NAME,
    assertUuid = common.assertUuid;
var errors = require('./errors');



// ---- globals

var DESCRIPTION = (
    'Manage SmartOS virtual machine images.\n'
);
var SUFFIX = (
    'See `imgadm help <command>` or the imgadm(1m) man page for more details.'
);



// ---- internal support stuff

/**
 * Print a table of the given items.
 *
 * @params items {Array}
 * @params options {Object}
 *      - `columns` {String} of comma-separated field names for columns
 *      - `skipHeader` {Boolean} Default false.
 *      - `sort` {String} of comma-separate fields on which to alphabetically
 *        sort the rows. Optional.
 *      - `validFields` {String} valid fields for `columns` and `sort`
 */
function tabulate(items, options) {
    assert.arrayOfObject(items, 'items');
    assert.object(options, 'options');
    assert.string(options.columns, 'options.columns');
    assert.optionalBool(options.skipHeader, 'options.skipHeader');
    assert.optionalString(options.sort, 'options.sort');
    assert.string(options.validFields, 'options.validFields');

    if (items.length === 0) {
        return;
    }

    // Validate.
    var validFields = options.validFields.split(',');
    var columns = options.columns.split(',');
    var sort = options.sort ? options.sort.split(',') : [];
    columns.forEach(function (c) {
        if (validFields.indexOf(c) === -1) {
            throw new TypeError(format('invalid output field: "%s"', c));
        }
    });
    sort.forEach(function (s) {
        if (validFields.indexOf(s) === -1) {
            throw new TypeError(format('invalid sort field: "%s"', s));
        }
    });

    // Determine columns and widths.
    var widths = {};
    columns.forEach(function (c) { widths[c] = c.length; });
    items.forEach(function (i) {
        columns.forEach(function (c) {
            widths[c] = Math.max(widths[c], (i[c] ? String(i[c]).length : 0));
        });
    });

    var template = '';
    columns.forEach(function (c) {
        template += '%-' + String(widths[c]) + 's  ';
    });
    template = template.trim();

    if (sort.length) {
        function cmp(a, b) {
            for (var i = 0; i < sort.length; i++) {
                var field = sort[i];
                var invert = false;
                if (field[0] === '-') {
                    invert = true;
                    field = field.slice(1);
                }
                assert.ok(field.length,
                    'zero-length sort field: ' + options.sort);
                var a_cmp = Number(a[field]);
                var b_cmp = Number(b[field]);
                if (isNaN(a_cmp) || isNaN(b_cmp)) {
                    a_cmp = a[field];
                    b_cmp = b[field];
                }
                if (a_cmp < b_cmp) {
                    return (invert ? 1 : -1);
                } else if (a_cmp > b_cmp) {
                    return (invert ? -1 : 1);
                }
            }
            return 0;
        }
        items.sort(cmp);
    }

    if (!options.skipHeader) {
        var header = columns.map(function (c) { return c.toUpperCase(); });
        header.unshift(template);
        console.log(sprintf.apply(null, header));
    }
    items.forEach(function (i) {
        var row = columns.map(function (c) {
            var cell = i[c];
            if (cell === null || cell === undefined) {
                return '-';
            } else {
                return String(i[c]);
            }
        });
        row.unshift(template);
        console.log(sprintf.apply(null, row));
    });
}


/**
 * Return an 80-column wrapped string.
 */
function textWrap(text) {
    var width = 80;
    var words = text.split(/\s+/g).reverse();
    var lines = [];
    var line = '';
    while (words.length) {
        var word = words.pop();
        if (line.length + 1 + word.length >= width) {
            lines.push(line);
            line = '';
        }
        if (line.length)
            line += ' ' + word;
        else
            line += word;
    }
    lines.push(line);
    return lines.join('\n');
}



// ---- CLI object

/**
 * Create an imgadm CLI instance.
 */
function CLI() {
    var self = this;
    this.name = NAME;
    this.description = DESCRIPTION;
    this.suffix = SUFFIX;
    this.envopts = [];

    // Load subcmds.
    this.subcmds = {};
    this.aliases = {};
    Object.keys(this.constructor.prototype)
        .filter(function (funcname) { return /^do_/.test(funcname); })
        .sort()
        .forEach(function (funcname) {
            var name = funcname.slice(3);
            var func = self.constructor.prototype[funcname];
            self.subcmds[name] = func;
            self.aliases[name] = name;
            (func.aliases || []).forEach(function (alias) {
                self.aliases[alias] = name;
            });
        });

    this.helpcmds = {};
    Object.keys(this.constructor.prototype)
        .filter(function (funcname) { return /^help_/.test(funcname); })
        .sort()
        .forEach(function (funcname) {
            var name = funcname.slice(5);
            var func = self.constructor.prototype[funcname];
            self.helpcmds[name] = func;
        });
}


/**
 * CLI mainline.
 *
 * @param argv {Array}
 * @param callback {Function} `function (helpErr, verbose)`
 *      Where `verbose` is a boolean indicating if verbose output was
 *      requested by user options.
 */
CLI.prototype.main = function main(argv, callback) {
    var self = this;
    this.handleArgv(argv, this.envopts, function (argvErr, opts) {
        if (argvErr) {
            callback(argvErr);
            return;
        }

        var verbose = Boolean(opts.verbose);
        var args = opts.argv.remain;
        if (opts.version) {
            console.log(self.name + ' ' + common.getVersion());
            callback(null, verbose);
            return;
        }
        if (args.length === 0) {
            self.printHelp(function (helpErr) { callback(helpErr, verbose); });
            return;
        } else if (opts.help) {
            // We want `cli foo -h` to show help for the 'foo' subcmd.
            if (args[0] !== 'help') {
                self.do_help(args[0], opts, args, callback);
                return;
            }
        }

        /*
         * Logging is to stderr. By default we log at the 'warn' level -- but
         * that is almost nothing. Logging is in Bunyan format (hence very
         * limited default logging), so need to pipe via `bunyan` for readable
         * output (at least until bunyan.js supports doing it inline).
         *
         * Admittedly this is a bit of a pain:
         *
         *      cli foo -vvv 2>&1 | bunyan
         *
         * Use -v|--verbose to increase the logging:
         * - 1: info
         * - 2: debug
         * - 3: trace and enable 'src' (source file location information)
         */
        var level = 'warn';
        var src = false;
        if (opts.verbose) {
            if (opts.verbose.length === 1) {
                level = 'info';
            } else if (opts.verbose.length === 2) {
                level = 'debug';
            } else {
                level = 'trace';
                src = true;
            }
        }
        self.log = bunyan.createLogger({
            name: self.name,
            streams: [
                {
                    stream: process.stderr,
                    level: level
                }
            ],
            src: src,
            serializers: bunyan.stdSerializers
        });
        self.log.debug({opts: opts, argv: argv}, 'parsed argv');

        imgadm.createTool({log: self.log}, function (createErr, tool) {
            if (createErr) {
                callback(createErr);
                return;
            }
            self.tool = tool;

            var subcmd = args.shift();
            try {
                self.dispatch(subcmd, argv,
                    function (dispErr) { callback(dispErr, verbose); });
            } catch (ex) {
                callback(ex, verbose);
            }
        });
    });
};


/**
 * Process options.
 *
 * @param argv {Array}
 * @param envopts {Array} Array or 2-tuples mapping envvar name to option for
 *      which it is a fallback.
 * @param callback {Function} `function (err, opts)`.
 */
CLI.prototype.handleArgv = function handleArgv(argv, envopts, callback) {
    var longOpts = this.longOpts = {
        'help': Boolean,
        'version': Boolean,
        'verbose': [Boolean, Array]
    };
    var shortOpts = this.shortOpts = {
        'h': ['--help'],
        'v': ['--verbose']
    };

    var opts = nopt(longOpts, shortOpts, argv, 2);

    // envopts
    (envopts || []).forEach(function (envopt) {
        var envname = envopt[0];
        var optname = envopt[1];
        if (process.env[envname] && !opts[optname]) {
            // console.log('set `opts.%s = "%s" from %s envvar',
            //     optname, process.env[envname], envname);
            opts[optname] = process.env[envname];
        }
    });

    callback(null, opts);
};

CLI.prototype.printHelp = function printHelp(callback) {
    var self = this;

    var lines = [];
    if (this.description) {
        lines.push(this.description);
    }

    lines = lines.concat([
        'Usage:',
        '    %s [<options>] <command> [<args>...]',
        '    %s help <command>',
        '',
        'Options:',
        '    -h, --help          Show this help message and exit.',
        '    --version           Show version and exit.',
        '    -v, --verbose       Debug logging. Multiple times for more.'
    ]);

    if (self.envopts && self.envopts.length) {
        var envTemplate = '    %-23s  %s';
        lines.push('');
        lines.push('Environment:');
        self.envopts.forEach(function (envopt) {
            var envname = envopt[0];
            var optname = envopt[1];
            lines.push(sprintf(envTemplate, envname,
                'Fallback for --' + optname));
        });
    }

    lines = lines.concat([
        '',
        'Commands:'
    ]);
    if (false) {
        // Automatic command line from `this.subcmds`.
        var cmdTemplate = '    %-18s  %s';
        Object.keys(this.subcmds).forEach(function (name) {
            var func = self.subcmds[name];
            if (func.hidden) {
                return;
            }
            var names = name;
            if (func.aliases) {
                names += sprintf(' (%s)', func.aliases.join(', '));
            }
            var desc = (func.description ?
                func.description.split('\n', 1)[0] : '');
            desc = desc.replace(/\$NAME/g, self.name);
            var line = sprintf(cmdTemplate, names, desc);
            lines.push(line);
        });
    } else {
        /* BEGIN JSSTYLED */
        // Manually written, but nicer, command summary.
        lines = lines.concat([
            '    imgadm help [<command>]                help on commands',
            '',
            '    imgadm sources [<options>]             list and edit image sources',
            '',
            '    imgadm avail                           list available images',
            '    imgadm show <uuid>                     show manifest of an available image',
            '',
            '    imgadm import [-P <pool>] <uuid>       import image from a source',
            '    imgadm install [-P <pool>] -m <manifest> -f <file>',
            '                                           import from local image data',
            '',
            '    imgadm list                            list installed images',
            '    imgadm get [-P <pool>] <uuid>          info on an installed image',
            '    imgadm update                          gather info on unknown images',
            '    imgadm delete [-P <pool>] <uuid>       remove an installed image'
            // '    imgadm publish -m <manifest> <snap>    publish (XXX:NYI)'
        ]);
        /* END JSSTYLED */
    }
    if (this.suffix) {
        lines.push('');
        lines.push(this.suffix);
    }

    console.log(lines.join('\n').replace(/%s/g, this.name));
    callback();
};

/**
 * Dispatch to the appropriate "do_SUBCMD" function.
 */
CLI.prototype.dispatch = function dispatch(subcmd, argv, callback) {
    var self = this;
    var name = this.aliases[subcmd];
    if (!name) {
        callback(new errors.UnknownCommandError(subcmd));
        return;
    }
    var func = this.subcmds[name];

    // Reparse the whole argv with merge global and subcmd options. This
    // is the only way (at least with `nopt`) to correctly parse subcmd opts.
    // It has the bonus of allowing *boolean* subcmd options before the
    // subcmd name, if that is helpful. E.g.:
    //      `joyent-imgadm -u trentm -j images`
    var longOpts = objCopy(this.longOpts);
    if (func.longOpts) {
        Object.keys(func.longOpts).forEach(
            function (k) { longOpts[k] = func.longOpts[k]; });
    }
    var shortOpts = objCopy(this.shortOpts);
    if (func.shortOpts) {
        Object.keys(func.shortOpts).forEach(
            function (k) { shortOpts[k] = func.shortOpts[k]; });
    }
    var opts = nopt(longOpts, shortOpts, argv, 2);
    self.log.trace({opts: opts, argv: argv}, 'parsed subcmd argv');

    // Die on unknown opts.
    var extraOpts = objCopy(opts);
    delete extraOpts.argv;
    Object.keys(longOpts).forEach(function (o) { delete extraOpts[o]; });
    extraOpts = Object.keys(extraOpts);
    if (extraOpts.length) {
        callback(new errors.UnknownOptionError(extraOpts.join(', ')));
        return;
    }

    var args = opts.argv.remain;
    delete opts.argv;
    assert.equal(subcmd, args.shift());
    func.call(this, subcmd, opts, args, callback);
};

CLI.prototype.do_help = function do_help(subcmd, opts, args, callback) {
    var self = this;
    if (args.length === 0) {
        this.printHelp(callback);
        return;
    }
    var alias = args[0];
    var name = this.aliases[alias];
    if (!name) {
        callback(new errors.UnknownCommandError(alias));
        return;
    }

    // If there is a `.help_NAME`, use that.
    var helpfunc = this.helpcmds[name];
    if (helpfunc) {
        helpfunc.call(this, alias, callback);
        return;
    }

    var func = this.subcmds[name];
    if (func.description) {
        var desc = func.description.replace(/\$NAME/g, self.name).trimRight();
        console.log(desc);
        callback();
    } else {
        callback(new errors.ImgapiCliError(format('no help for "%s"', alias)));
    }
};
CLI.prototype.do_help.aliases = ['?'];
CLI.prototype.do_help.description
    = 'Give detailed help on a specific sub-command.';

CLI.prototype.help_help = function help_help(subcmd, callback) {
    this.printHelp(callback);
};


CLI.prototype.do_sources = function do_sources(subcmd, opts, args, callback) {
    var self = this;
    if (args.length > 0) {
        callback(new errors.UsageError(
            'unexpected args: ' + args.join(' ')));
        return;
    }
    var nActions = 0;
    if (opts.edit) nActions++;
    if (opts.add) nActions++;
    if (opts.del) nActions++;
    if (nActions > 1) {
        callback(new errors.UsageError(
            'cannot specify more than one of "-a", "-d" and "-e"'));
        return;
    }
    var skipPingCheck = opts.force === true;
    if (opts.edit) {
        var before = self.tool.sources.map(function (s) { return s.url; });
        var beforeText = before.join('\n')
            + '\n\n'
            + '#\n'
            + '# Enter source URLs, on per line.\n'
            + '# Comments beginning with "#" are stripped.\n'
            + '#\n';
        var tmpPath = path.resolve(os.tmpDir(),
            format('imgadm-sources-%s.txt', process.pid));
        fs.writeFileSync(tmpPath, beforeText, 'utf8');

        var vi = spawn('/usr/bin/vi', ['-f', tmpPath], {stdio: 'inherit'});
        vi.on('exit', function (code) {
            if (code) {
                console.warn('Error editing image sources: %s (ignoring)',
                    code);
                callback();
                return;
            }
            var afterText = fs.readFileSync(tmpPath, 'utf8');
            fs.unlinkSync(tmpPath);
            if (afterText === beforeText) {
                console.log('Image sources unchanged');
                callback();
                return;
            }
            var after = afterText.trim().split(/\n/g).filter(function (line) {
                line = line.split('#')[0].trim();
                if (line.length === 0)
                    return false;
                return true;
            });
            if (after.join('\n') === before.join('\n')) {
                console.log('Image sources unchanged');
                callback();
                return;
            }
            self.tool.updateSourceUrls(after, skipPingCheck,
                function (err, changes) {
                    if (err) {
                        callback(err);
                    } else {
                        changes.forEach(function (change) {
                            if (change.type === 'reorder') {
                                console.log('Reordered image sources');
                            } else if (change.type === 'add') {
                                console.log('Added image source "%s"',
                                    change.url);
                            } else if (change.type === 'del') {
                                console.log('Deleted image source "%s"',
                                    change.url);
                            }
                        });
                        callback();
                    }
                });
        });
    } else if (opts.add) {
        this.tool.configAddSource({url: opts.add}, skipPingCheck,
            function (err, changed) {
                if (err) {
                    callback(err);
                } else if (changed) {
                    console.log('Added image source "%s"', opts.add);
                } else {
                    console.log('Already have image source "%s", no change',
                        opts.add);
                }
            }
        );
    } else if (opts.del) {
        this.tool.configDelSourceUrl(opts.del, function (err, changed) {
            if (err) {
                callback(err);
            } else if (changed) {
                console.log('Deleted image source "%s"', opts.del);
            } else {
                console.log('Do not have image source "%s", no change',
                    opts.del);
            }
        });
    } else {
        var sources = this.tool.sources.map(function (s) {
            return s.url;
        });
        if (opts.json) {
            console.log(JSON.stringify(sources, null, 2));
        } else {
            sources.forEach(function (s) {
                console.log(s);
            });
        }
        callback();
    }
};
CLI.prototype.do_sources.description = (
    /* BEGIN JSSTYLED */
    'List and edit image sources.\n'
    + '\n'
    + 'An image source is a URL to a server implementing the IMGAPI.\n'
    + 'The default IMGAPI is + ' + common.DEFAULT_SOURCE.url + '\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME sources [<options>...]\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -j, --json         List sources as JSON.\n'
    + '    -a SOURCE          Add a source. It is appended to the list of sources.\n'
    + '    -d SOURCE          Delete a source.\n'
    + '    -e                 Edit sources in an editor.\n'
    + '    -f                 Force no "ping check" on new source URLs. By default\n'
    + '                       a ping check is done against new source URLs to\n'
    + '                       attempt to ensure they are a running IMGAPI server.\n'
    /* END JSSTYLED */
);
CLI.prototype.do_sources.longOpts = {
    'json': Boolean,
    'add': String,
    'del': String,
    'edit': Boolean,
    'force': Boolean
};
CLI.prototype.do_sources.shortOpts = {
    'j': ['--json'],
    'a': ['--add'],
    'd': ['--del'],
    'e': ['--edit'],
    'f': ['--force']
};


var availValidFields = [
    'source',
    'uuid',
    'owner',
    'name',
    'version',
    'state',
    'disabled',
    'public',
    'published',
    'published_at',
    'published_date',
    'type',
    'os',
    'urn',
    'nic_driver',
    'disk_driver',
    'cpu_type',
    'image_size',
    'generate_passwords',
    'description'
];
CLI.prototype.do_avail = function do_avail(subcmd, opts, args, callback) {
    var self = this;
    if (args.length) {
        callback(new errors.UsageError(
            'unexpected args: ' + args.join(' ')));
        return;
    }
    self.tool.sourcesList(function (err, imagesInfo) {
        if (err) {
            callback(err);
            return;
        }
        if (opts.json) {
            console.log(JSON.stringify(imagesInfo, null, 2));
        } else {
            var table = [];
            imagesInfo.forEach(function (i) {
                var row = i.manifest;
                if (row.published_at) {
                    // Just the date.
                    row.published_date = row.published_at.slice(0, 10);
                    // Normalize on no milliseconds.
                    row.published = row.published_at.replace(/\.\d+Z$/, 'Z');
                }
                row.source = i.source;
                table.push(row);
            });
            try {
                tabulate(table, {
                    skipHeader: opts.skipHeader,
                    columns: opts.output || 'uuid,name,version,os,published',
                    sort: opts.sort || 'published_at,name',
                    validFields: availValidFields.join(',')
                });
            } catch (e) {
                callback(e);
                return;
            }
        }
        callback();
    });
};
CLI.prototype.do_avail.description = (
    'List available images from all sources.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME avail [<options>...]\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -j, --json         JSON output\n'
    + '    -H                 Do not print table header row\n'
    + '    -o field1,...      Specify fields (columns) to output. Default is\n'
    + '                       "uuid,name,version,os,published".\n'
    + '    -s field1,...      Sort on the given fields. Default is\n'
    + '                       "published_at,name".\n'
    + '\n'
    + textWrap('Valid fields for "-o" and "-s" are: '
        + availValidFields.join(', ') + '.') + '\n'
);
CLI.prototype.do_avail.longOpts = {
    'json': Boolean,
    'skipHeader': Boolean,
    'output': String,
    'sort': String
};
CLI.prototype.do_avail.shortOpts = {
    'j': ['--json'],
    'H': ['--skipHeader'],
    'o': ['--output'],
    's': ['--sort']
};
CLI.prototype.do_avail.aliases = ['available'];


var listValidFields = [
    'source',
    'uuid',
    'owner',
    'name',
    'version',
    'state',
    'disabled',
    'public',
    'published',
    'published_at',
    'type',
    'os',
    'urn',
    'nic_driver',
    'disk_driver',
    'cpu_type',
    'image_size',
    'generate_passwords',
    'description',
    'clones',
    'zpool'
];
CLI.prototype.do_list = function do_list(subcmd, opts, args, callback) {
    var self = this;
    if (args.length) {
        callback(new errors.UsageError(
            'unexpected args: ' + args.join(' ')));
        return;
    }
    var log = self.log;
    log.debug({opts: opts}, 'list');
    self.tool.listImages(function (err, imagesInfo) {
        log.debug({err: err, imagesInfo: imagesInfo}, 'listImages');
        if (err) {
            callback(err);
            return;
        }
        if (opts.json) {
            console.log(JSON.stringify(imagesInfo, null, 2));
        } else {
            var table = [];
            imagesInfo.forEach(function (i) {
                var row = i.manifest;
                if (row.published_at) {
                    // Just the date.
                    row.published_date = row.published_at.slice(0, 10);
                    // Normalize on no milliseconds.
                    row.published = row.published_at.replace(/\.\d+Z$/, 'Z');
                }
                row.source = i.source;
                row.clones = i.clones;
                row.zpool = i.zpool;
                table.push(row);
            });
            try {
                tabulate(table, {
                    skipHeader: opts.skipHeader,
                    columns: opts.output || 'uuid,name,version,os,published',
                    sort: opts.sort || 'published_at,name',
                    validFields: listValidFields.join(',')
                });
            } catch (e) {
                callback(e);
                return;
            }
            callback();
        }
    });
};
CLI.prototype.do_list.description = (
    'List locally installed images.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME list [<options>...]\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -j, --json         JSON output\n'
    + '    -H                 Do not print table header row\n'
    + '    -o field1,...      Specify fields (columns) to output. Default is\n'
    + '                       "uuid,name,version,os,published".\n'
    + '    -s field1,...      Sort on the given fields. Default is\n'
    + '                       "published_at,name".\n'
    + '\n'
    + textWrap('Valid fields for "-o" and "-s" are: '
        + listValidFields.join(', ') + '.') + '\n'
);
CLI.prototype.do_list.longOpts = {
    'json': Boolean,
    'skipHeader': Boolean,
    'output': String,
    'sort': String
};
CLI.prototype.do_list.shortOpts = {
    'j': ['--json'],
    'H': ['--skipHeader'],
    'o': ['--output'],
    's': ['--sort']
};


CLI.prototype.do_show = function do_show(subcmd, opts, args, callback) {
    var self = this;
    if (args.length !== 1) {
        callback(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    self.tool.sourcesGet(uuid, function (err, imageInfo) {
        if (err) {
            callback(err);
            return;
        }
        if (!imageInfo) {
            err = new errors.ImageNotFoundError(uuid);
        } else {
            console.log(JSON.stringify(imageInfo.manifest, null, 2));
        }
        callback(err);
    });
};
CLI.prototype.do_show.description = (
    'Show the manifest for an available image.\n'
    + '\n'
    + 'This searches each imgadm source for an available image with this UUID\n'
    + 'and prints its manifest.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME show <uuid>\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
);


CLI.prototype.do_get = function do_get(subcmd, opts, args, callback) {
    var self = this;
    if (args.length !== 1) {
        callback(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    var zpool = opts.zpool || common.DEFAULT_ZPOOL;
    var getOpts = {uuid: uuid, zpool: zpool, children: opts.children};
    self.tool.getImage(getOpts, function (err, imageInfo) {
        if (err) {
            callback(err);
            return;
        }
        if (!imageInfo) {
            callback(new errors.ImageNotInstalledError(zpool, uuid));
            return;
        }
        console.log(JSON.stringify(imageInfo, null, 2));
        callback();
    });
};
CLI.prototype.do_get.description = (
    'Get information for an installed image.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME get <uuid>\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -r                 Recursively gather children (child snapshots\n'
    + '                       and dependent clones).\n'
    + '    -P <pool>          Name of zpool in which to look for the image.\n'
    + '                       Default is "' + common.DEFAULT_ZPOOL + '".\n'
);
CLI.prototype.do_get.aliases = ['info'];
CLI.prototype.do_get.longOpts = {
    'zpool': String,
    'children': Boolean
};
CLI.prototype.do_get.shortOpts = {
    'P': ['--zpool'],
    'r': ['--children']
};


/**
 * `imgadm delete <uuid>`
 */
CLI.prototype.do_delete = function do_delete(subcmd, opts, args, callback) {
    var self = this;
    if (args.length !== 1) {
        callback(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    var zpool = opts.zpool || common.DEFAULT_ZPOOL;

    self.tool.deleteImage({uuid: uuid, zpool: zpool}, function (err) {
        if (err) {
            callback(err);
            return;
        }
        console.log('Deleted image %s/%s', zpool, uuid);
    });
};
CLI.prototype.do_delete.description = (
    /* BEGIN JSSTYLED */
    'Delete an image from the local zpool.\n'
    + '\n'
    + 'The removal can only succeed if the image is not actively in use by a VM.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME delete <uuid>\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -P <pool>          Name of zpool from which to delete the image.\n'
    + '                       Default is "' + common.DEFAULT_ZPOOL + '".\n'
    /* END JSSTYLED */
);
CLI.prototype.do_delete.aliases = ['destroy'];
CLI.prototype.do_delete.longOpts = {
    'zpool': String
};
CLI.prototype.do_delete.shortOpts = {
    'P': ['--zpool']
};


/**
 * `imgadm import <uuid>`
 */
CLI.prototype.do_import = function do_import(subcmd, opts, args, callback) {
    var self = this;
    if (args.length !== 1) {
        callback(new errors.UsageError(format(
            'incorrect number of args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    var uuid = args[0];
    assertUuid(uuid);
    var zpool = opts.zpool || common.DEFAULT_ZPOOL;

    // 1. Ensure we don't already have this UUID installed.
    self.tool.getImage({uuid: uuid, zpool: zpool}, function (getErr, ii) {
        if (getErr) {
            callback(getErr);
            return;
        }
        if (ii) {
            callback(new errors.ImageAlreadyInstalledError(uuid));
            return;
        }

        // 2. Find this image in the sources.
        self.tool.sourcesGet(uuid, function (sGetErr, imageInfo) {
            if (sGetErr) {
                callback(sGetErr);
                return;
            } else if (!imageInfo) {
                callback(new errors.ImageNotFoundError(uuid));
                return;
            }
            self.log.trace({imageInfo: imageInfo},
                'found source for image %s', uuid);
            console.log('Importing image %s (%s %s) from "%s"', uuid,
                imageInfo.manifest.name, imageInfo.manifest.version,
                imageInfo.source.url);

            // 3. Import it.
            var importOpts = {
                manifest: imageInfo.manifest,
                source: imageInfo.source,
                zpool: zpool,
                quiet: opts.quiet
            };
            self.tool.importImage(importOpts, function (importErr) {
                if (importErr) {
                    callback(importErr);
                    return;
                }
                console.log('Imported image %s to "%s/%s".', uuid, zpool, uuid);
                callback();
            });
        });
    });
};
CLI.prototype.do_import.description = (
    'Import an image from a source IMGAPI.\n'
    + '\n'
    + 'This finds the image with the given UUID in the configured sources\n'
    + 'and imports it into the local system.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME import <uuid>\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -P <pool>          Name of zpool in which to import the image.\n'
    + '                       Default is "' + common.DEFAULT_ZPOOL + '".\n'
    + '    -q, --quiet        Disable progress bar.\n'
);
CLI.prototype.do_import.longOpts = {
    'zpool': String,
    'quiet': Boolean
};
CLI.prototype.do_import.shortOpts = {
    'P': ['--zpool'],
    'q': ['--quiet']
};



/**
 * `imgadm install -m <manifest> -f <file>`
 */
CLI.prototype.do_install = function do_install(subcmd, opts, args, callback) {
    var self = this;
    if (args.length !== 0) {
        callback(new errors.UsageError(format(
            'unexpected args (%d): "%s"',
            args.length, args.join(' '))));
        return;
    }
    assert.string(opts.manifest, 'opts.manifest');
    assert.string(opts.file, 'opts.file');
    assert.optionalString(opts.zpool, 'opts.zpool');
    var zpool = opts.zpool || common.DEFAULT_ZPOOL;

    // 1. Validate args.
    if (!fs.existsSync(opts.manifest)) {
        callback(new errors.UsageError(format(
            'manifest path does not exist: "%s"', opts.manifest)));
        return;
    }
    if (!fs.existsSync(opts.file)) {
        callback(new errors.UsageError(format(
            'file path does not exist: "%s"', opts.file)));
        return;
    }
    try {
        var manifest = JSON.parse(fs.readFileSync(opts.manifest, 'utf8'));
    } catch (err) {
        callback(new errors.InvalidManifestError(err));
        return;
    }
    var uuid = manifest.uuid;
    assertUuid(uuid, 'manifest.uuid');

    // 2. Ensure we don't already have this UUID installed.
    self.tool.getImage({uuid: uuid, zpool: zpool}, function (getErr, ii) {
        if (getErr) {
            callback(getErr);
            return;
        }
        if (ii) {
            callback(new errors.ImageAlreadyInstalledError(uuid));
            return;
        }

        // 3. Install it.
        console.log('Installing image %s (%s %s)', uuid, manifest.name,
            manifest.version);
        var installOpts = {
            manifest: manifest,
            zpool: zpool,
            file: opts.file
        };
        self.tool.installImage(installOpts, function (installErr) {
            if (installErr) {
                callback(installErr);
                return;
            }
            console.log('Installed image %s to "%s/%s".', uuid, zpool, uuid);
            callback();
        });
    });
};
CLI.prototype.do_install.description = (
    /* BEGIN JSSTYLED */
    'Install an image from local manifest and image data files.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME install [<options>] -m <manifest> -f <file>\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
    + '    -m MANIFEST        Required. Path to the image manifest file to import.\n'
    + '    -f FILE            Required. Path to the image file to import.\n'
    + '    -P <pool>          Name of zpool in which to import the image.\n'
    + '                       Default is "' + common.DEFAULT_ZPOOL + '".\n'
    + '    -q, --quiet        Disable progress bar.\n'
    /* END JSSTYLED */
);
CLI.prototype.do_install.longOpts = {
    'manifest': String,
    'file': String,
    'zpool': String,
    'quiet': Boolean
};
CLI.prototype.do_install.shortOpts = {
    'm': ['--manifest'],
    'f': ['--file'],
    'P': ['--zpool'],
    'q': ['--quiet']
};


/**
 * `imgadm update`
 */
CLI.prototype.do_update = function do_update(subcmd, opts, args, callback) {
    if (args.length) {
        callback(new errors.UsageError(format(
            'unexpected arguments: "%s"', args.join(' '))));
        return;
    }
    this.tool.updateImages(callback);
};
CLI.prototype.do_update.description = (
    'Gather info on unknown images.\n'
    + '\n'
    + 'Images that are installed without "imgadm" (e.g. via "zfs recv")\n'
    + 'not have cached image manifest information. This command will attempt\n'
    + 'to retrieve this information from current image sources based on image\n'
    + 'UUID.\n'
    + '\n'
    + 'Usage:\n'
    + '    $NAME update\n'
    + '\n'
    + 'Options:\n'
    + '    -h, --help         Print this help and exit.\n'
);



// ---- exports

module.exports = CLI;
