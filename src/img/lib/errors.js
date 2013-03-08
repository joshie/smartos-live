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
 * Error classes that imgadm may produce.
 */

var util = require('util');
var assert = require('assert-plus');
var sprintf = require('extsprintf').sprintf;
var verror = require('verror'),
    WError = verror.WError,
    VError = verror.VError;



// ---- error classes

/**
 * Base imgadm error. Instances will always have a string `message` and
 * a string `code` (a CamelCase string). The possible codes are those
 * for every error subclass here, plus the possible `restCode` error
 * responses from IMGAPI.
 * See <https://mo.joyent.com/docs/imgapi/master/#errors>.
 */
function ImgadmError(options) {
    assert.object(options, 'options');
    assert.string(options.message, 'options.message');
    assert.string(options.code, 'options.code');
    assert.optionalObject(options.cause, 'options.cause');
    assert.optionalNumber(options.statusCode, 'options.statusCode');
    var self = this;

    var args = [];
    if (options.cause) args.push(options.cause);
    args.push(options.message);
    WError.apply(this, args);

    var extra = Object.keys(options).filter(
        function (k) { return ['cause', 'message'].indexOf(k) === -1; });
    extra.forEach(function (k) {
        self[k] = options[k];
    });
}
util.inherits(ImgadmError, WError);

function InternalError(options) {
    assert.object(options, 'options');
    assert.optionalString(options.source, 'options.source');
    assert.optionalObject(options.cause, 'options.cause');
    assert.string(options.message, 'options.message');
    var message = options.message;
    if (options.source) {
        message = options.source + ': ' + message;
    }
    ImgadmError.call(this, {
        cause: options.cause,
        message: message,
        code: 'InternalError',
        exitStatus: 1
    });
}
util.inherits(InternalError, ImgadmError);

function NoSourcesError() {
    ImgadmError.call(this, {
        message: sprintf('imgadm has no configured sources'),
        code: 'NoSources',
        exitStatus: 1
    });
}
util.inherits(NoSourcesError, ImgadmError);

function SourcePingError(cause, source) {
    if (source === undefined) {
        source = cause;
        cause = undefined;
    }
    assert.object(source, 'source');
    ImgadmError.call(this, {
        cause: cause,
        message: sprintf('unexpected ping error with image source "%s" (%s)',
            source.url, source.type),
        code: 'SourcePing',
        exitStatus: 1
    });
}
util.inherits(SourcePingError, ImgadmError);

function ImageNotFoundError(cause, uuid) {
    if (uuid === undefined) {
        uuid = cause;
        cause = undefined;
    }
    assert.string(uuid);
    ImgadmError.call(this, {
        cause: cause,
        message: sprintf('image "%s" was not found', uuid),
        code: 'ImageNotFound',
        exitStatus: 1
    });
}
util.inherits(ImageNotFoundError, ImgadmError);

function ImageNotInstalledError(cause, zpool, uuid) {
    if (uuid === undefined) {
        // `cause` was not provided.
        uuid = zpool;
        zpool = cause;
        cause = undefined;
    }
    assert.string(zpool, 'zpool');
    assert.string(uuid, 'uuid');
    ImgadmError.call(this, {
        cause: cause,
        message: sprintf('image "%s" was not found on zpool "%s"', uuid, zpool),
        code: 'ImageNotInstalled',
        exitStatus: 3
    });
}
util.inherits(ImageNotInstalledError, ImgadmError);

function ImageAlreadyInstalledError(cause, uuid) {
    if (uuid === undefined) {
        uuid = cause;
        cause = undefined;
    }
    assert.string(uuid);
    ImgadmError.call(this, {
        cause: cause,
        message: sprintf('image is already installed: "%s"', uuid),
        code: 'ImageAlreadyInstalled',
        exitStatus: 1
    });
}
util.inherits(ImageAlreadyInstalledError, ImgadmError);

function ImageHasDependentClonesError(cause, imageInfo) {
    if (imageInfo === undefined) {
        imageInfo = cause;
        cause = undefined;
    }
    assert.object(imageInfo, 'imageInfo');
    assert.string(imageInfo.manifest.uuid, 'imageInfo.manifest.uuid');
    var clones = imageInfo.children.clones;
    assert.arrayOfString(clones, 'imageInfo.children.clones');
    var message = sprintf('image "%s" has dependent clones: %s',
        imageInfo.manifest.uuid, clones[0]);
    if (clones.length > 1) {
        message += sprintf(' and %d others...', clones.length - 1);
    }
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'ImageHasDependentClones',
        exitStatus: 1
    });
}
util.inherits(ImageHasDependentClonesError, ImgadmError);

function InvalidUUIDError(cause, uuid) {
    if (uuid === undefined) {
        uuid = cause;
        cause = undefined;
    }
    assert.string(uuid);
    ImgadmError.call(this, {
        cause: cause,
        message: sprintf('invalid uuid: "%s"', uuid),
        code: 'InvalidUUID',
        exitStatus: 1
    });
}
util.inherits(InvalidUUIDError, ImgadmError);

function InvalidManifestError(cause) {
    assert.optionalObject(cause);
    var message = 'manifest is invalid';
    if (cause) {
        message += ': ' + (cause.message || String(cause));
    }
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'InvalidManifest',
        exitStatus: 1
    });
}
util.inherits(InvalidManifestError, ImgadmError);

function UsageError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'Usage',
        exitStatus: 1
    });
}
util.inherits(UsageError, ImgadmError);

function UnknownOptionError(cause, option) {
    if (option === undefined) {
        option = cause;
        cause = undefined;
    }
    assert.string(option);
    ImgadmError.call(this, {
        cause: cause,
        message: sprintf('unknown option: "%s"', option),
        code: 'UnknownOption',
        exitStatus: 1
    });
}
util.inherits(UnknownOptionError, ImgadmError);

function UnknownCommandError(cause, command) {
    if (command === undefined) {
        command = cause;
        cause = undefined;
    }
    assert.string(command);
    ImgadmError.call(this, {
        cause: cause,
        message: sprintf('unknown command: "%s"', command),
        code: 'UnknownCommand',
        exitStatus: 1
    });
}
util.inherits(UnknownCommandError, ImgadmError);

function ClientError(source, cause) {
    assert.string(source, 'source');
    assert.object(cause, 'cause');
    ImgadmError.call(this, {
        cause: cause,
        message: sprintf('%s: %s', source, cause),
        code: 'ClientError',
        exitStatus: 1
    });
}
ClientError.description = 'An error from a syscall in the IMGAPI client.';
util.inherits(ClientError, ImgadmError);


function APIError(source, cause) {
    assert.string(source, 'source');
    assert.object(cause, 'cause');
    assert.optionalNumber(cause.statusCode, 'cause.statusCode');
    assert.string(cause.body.code, 'cause.body.code');
    assert.string(cause.body.message, 'cause.body.message');
    var message = cause.body.message;
    if (cause.body.errors) {
        cause.body.errors.forEach(function (e) {
            message += sprintf('\n    %s: %s', e.field, e.code);
            if (e.message) {
                message += ': ' + e.message;
            }
        });
    }
    ImgadmError.call(this, {
        cause: cause,
        message: sprintf('%s: %s', source, message),
        code: cause.body.code,
        statusCode: cause.statusCode,
        exitStatus: 1
    });
}
APIError.description = 'An error from the IMGAPI http request.';
util.inherits(APIError, ImgadmError);


function DownloadError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.optionalObject(cause);
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'DownloadError'
    });
}
util.inherits(DownloadError, ImgadmError);

function ConfigError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.optionalObject(cause);
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'ConfigError'
    });
}
util.inherits(ConfigError, ImgadmError);


function UpgradeError(cause, message) {
    if (message === undefined) {
        message = cause;
        cause = undefined;
    }
    assert.optionalObject(cause);
    assert.string(message);
    ImgadmError.call(this, {
        cause: cause,
        message: message,
        code: 'UpgradeError'
    });
}
util.inherits(UpgradeError, ImgadmError);


/**
 * Multiple ImgadmErrors in a group.
 */
function MultiError(errs) {
    assert.arrayOfObject(errs, 'errs');
    var lines = [sprintf('multiple (%d) API errors', errs.length)];
    for (var i = 0; i < errs.length; i++) {
        var err = errs[i];
        lines.push(sprintf('    error (%s): %s', err.code, err.message));
    }
    ImgadmError.call(this, {
        cause: errs[0],
        message: lines.join('\n'),
        code: 'MultiError',
        exitStatus: 1
    });
}
MultiError.description = 'Multiple IMGADM errors.';
util.inherits(MultiError, ImgadmError);



// ---- exports

module.exports = {
    ImgadmError: ImgadmError,
    InternalError: InternalError,
    InvalidUUIDError: InvalidUUIDError,
    NoSourcesError: NoSourcesError,
    SourcePingError: SourcePingError,
    ImageNotFoundError: ImageNotFoundError,
    ImageNotInstalledError: ImageNotInstalledError,
    ImageAlreadyInstalledError: ImageAlreadyInstalledError,
    ImageHasDependentClonesError: ImageHasDependentClonesError,
    InvalidManifestError: InvalidManifestError,
    UsageError: UsageError,
    UnknownOptionError: UnknownOptionError,
    UnknownCommandError: UnknownCommandError,
    ClientError: ClientError,
    APIError: APIError,
    DownloadError: DownloadError,
    ConfigError: ConfigError,
    UpgradeError: UpgradeError,
    MultiError: MultiError
};
