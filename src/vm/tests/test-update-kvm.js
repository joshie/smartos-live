// Copyright 2012 Joyent, Inc.  All rights reserved.

process.env['TAP'] = 1;
var async = require('/usr/node/node_modules/async');
var execFile = require('child_process').execFile;
var test = require('tap').test;
var VM = require('/usr/vm/node_modules/VM');

VM.loglevel = 'DEBUG';

var vm_uuid;

var PAYLOADS = {
    "create": {
        "brand": "kvm",
        "ram": 256,
        "autoboot": false,
        "alias": "autotest-vm" + process.pid,
        "disks": [{"size": 1024, "model": "ide"}],
        "do_not_inventory": true
    }, "add_net0": {
        "add_nics": [
            {
                "model": "e1000",
                "ip": "10.254.254.254",
                "netmask": "255.255.255.0",
                "nic_tag": "external",
                "interface": "net0",
                "vlan_id": 0,
                "gateway": "10.254.254.1",
                "mac": "01:02:03:04:05:06"
            }
        ]
    }, "remove_net0": {
        "remove_nics": [
            "01:02:03:04:05:06"
        ]
    }, "add_net0_and_net1": {
        "add_nics": [
            {
                "model": "virtio",
                "ip": "10.254.254.254",
                "netmask": "255.255.255.0",
                "nic_tag": "external",
                "interface": "net0",
                "vlan_id": 0,
                "gateway": "10.254.254.1",
                "mac": "01:02:03:04:05:06"
            }, {
                "model": "virtio",
                "ip": "10.254.254.253",
                "netmask": "255.255.255.0",
                "nic_tag": "external",
                "interface": "net1",
                "vlan_id": 253,
                "gateway": "10.254.254.1",
                "mac": "02:03:04:05:06:07"
            }
        ]
    }, "remove_net0_and_net1": {
        "remove_nics": [
            "01:02:03:04:05:06",
            "02:03:04:05:06:07"
        ]
    }
};

simple_properties = [
    ['alias', 'useless VM'],
    ['billing_id', '9.99'],
    ['hostname', 'hamburgerhelper'],
    ['owner_uuid', '36bf401a-28ef-11e1-b4a7-c344deb1a5d6'],
    ['package_name', 'really expensive package'],
    ['package_version', 'XP'],
    ['virtio_txtimer', 150000],
    ['virtio_txtimer', '200000', 200000],
    ['virtio_txburst', 256],
    ['virtio_txburst', '128', 128]
];

test('create zone', {'timeout': 240000}, function(t) {
    VM.create(PAYLOADS.create, function (err, vmobj) {
        if (err) {
            t.ok(false, 'error creating VM: ' + err.message);
        } else {
            vm_uuid = vmobj.uuid;
            t.ok(true, 'created VM: ' + vm_uuid);
        }
        t.end();
    });
});

test('update disk model', {'timeout': 60000}, function(t) {

    VM.load(vm_uuid, function (err, before_obj) {
        var path;

        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }

        path = before_obj.disks[0].path;

        VM.update(vm_uuid, {'update_disks': [{'path': path, 'model': 'virtio'}]}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }
                    t.ok((obj.disks[0].model === 'virtio'), 'obj.disks[0].model: '
                        + obj.disks[0].model + ' expected: virtio');
                    t.end();
                });
            }
        });
    });
});

test('boot zone', function(t) {
    VM.start(vm_uuid, {}, function (err) {
        t.ok(!err, 'error starting VM' + (err ? ': ' + err.message : ''));
        t.end();
    });
});

test('add net0', {'timeout': 60000}, function(t) {
    VM.update(vm_uuid, PAYLOADS.add_net0, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                failures = 0;
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 1) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 1 nics');
                } else {
                    for (field in PAYLOADS.add_net0.add_nics[0]) {
                        if (field === 'physical') {
                            // physical is a property that gets added but not in the obj
                            continue;
                        }
                        if (obj.nics[0][field] !== PAYLOADS.add_net0.add_nics[0][field]) {
                            t.ok(false, 'failed to set ' + field + ', was [' + obj.nics[0][field] +
                                '], expected [' + PAYLOADS.add_net0.add_nics[0][field] + ']');
                            failures++;
                        }
                    }
                }
                if (failures === 0) {
                    t.ok(true, 'updated VM: ' + vm_uuid);
                }
                t.end();
            });
        }
    });
});

test('update nic model', {'timeout': 60000}, function(t) {

    VM.load(vm_uuid, function (err, before_obj) {
        var mac;

        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }

        if (!before_obj || !before_obj.hasOwnProperty('nics')
            || before_obj.nics.length < 1) {

            t.ok(false, 'VM is in a broken state before NIC update');
            t.end();
            return;
        }

        mac = before_obj.nics[0].mac;

        VM.update(vm_uuid, {'update_nics': [{'mac': mac, 'model': 'virtio'}]}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }
                    t.ok((obj.nics[0].model === 'virtio'), 'obj.nics[0].model: '
                        + obj.nics[0].model + ' expected: virtio');
                    t.end();
                });
            }
        });
    });
});

test('remove net0', function(t) {
    VM.update(vm_uuid, PAYLOADS.remove_net0, function(err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 0) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 0 nics');
                } else {
                    t.ok(true, 'Successfully removed net0 from VM');
                }
                t.end();
            });
        }
    });
});

test('add net0 and net1', function(t) {
    VM.update(vm_uuid, PAYLOADS.add_net0_and_net1, function (err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                failures = 0;
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 2) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 2 nics');
                } else {
                    for (nic in [0, 1]) {
                        for (field in PAYLOADS.add_net0_and_net1.add_nics[nic]) {
                            if (field === 'physical') {
                                // physical is a property that gets added but not in the obj
                                continue;
                            }
                            if (obj.nics[nic][field] !== PAYLOADS.add_net0_and_net1.add_nics[nic][field]) {
                                t.ok(false, 'failed to set ' + field + ', was [' + obj.nics[nic][field] +
                                    '], expected [' + PAYLOADS.add_net0_and_net1.add_nics[nic][field] + ']');
                                failures++;
                            }
                        }
                    }
                }
                if (failures === 0) {
                    t.ok(true, 'updated VM: ' + vm_uuid);
                }
                t.end();
            });
        }
    });
});

test('remove net0 and net1', function(t) {
    VM.update(vm_uuid, PAYLOADS.remove_net0_and_net1, function(err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                } else if (obj.nics.length !== 0) {
                    t.ok(false, 'VM has ' + obj.nics.length + ' != 0 nics');
                } else {
                    t.ok(true, 'Successfully removed net0 and net1 from VM');
                }
                t.end();
            });
        }
    });
});

test('set then unset simple properties', {'timeout': 240000}, function(t) {
    async.forEachSeries(simple_properties,
        function (item, cb) {
            var prop = item[0];
            var value = item[1];
            var expected_value = item[2];
            var payload = {};

            payload[prop] = value;

            if (expected_value === undefined) {
                expected_value = value;
            }

            VM.update(vm_uuid, payload, function(err) {
                if (err) {
                    t.ok(false, 'error updating VM: ' + err.message);
                    cb();
                } else {
                    VM.load(vm_uuid, function (err, obj) {
                        if (err) {
                            t.ok(false, 'failed reloading VM');
                            return cb();
                        } else {
                            t.ok(obj[prop] === expected_value, prop + ' is '
                                + obj[prop] + ' (' + typeof(obj[prop])
                                + '), expected: ' + expected_value + ' ('
                                + typeof(expected_value) + ')'
                            );
                        }
                        payload[prop] = undefined;
                        VM.update(vm_uuid, payload, function (err) {
                            if (err) {
                                t.ok(false, 'error updating VM: ' + err.message);
                                cb();
                            } else {
                                VM.load(vm_uuid, function (err, obj) {
                                    if (err) {
                                        t.ok(false, 'failed reloading VM');
                                        return cb();
                                    }
                                    t.ok(!obj.hasOwnProperty(prop), prop
                                        + ' is ' + obj[prop] + ' ('
                                        + typeof(obj[prop]) + '), expected: '
                                        + 'undefined');
                                    cb();
                                });
                            }
                        });
                    });
                }
            });
        },
        function (err) {
            t.end();
        }
    );
});

test('update quota', function(t) {
    VM.update(vm_uuid, {'quota': 13}, function(err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                    t.end();
                } else if (obj.quota !== 13) {
                    t.ok(false, 'VM has ' + obj.quota + ' != 13');
                    t.end();
                } else {
                    execFile('/usr/sbin/zfs', ['get', '-H', '-o', 'value', 'quota', obj.zonepath.substr(1)],
                        function (error, stdout, stderr) {
                            var res;
                            if (error) {
                                t.ok(false, 'Failed to get quota from zfs: ' + e.message);
                            } else {
                                res = stdout.replace(new RegExp("[\\s]+$", "g"), "");
                                t.ok(res === '13G', 'updated quota now: ' + res + ' vs 13G');
                            }
                            t.end();
                        }
                    );
                }
            });
        }
    });
});

test('remove quota', function(t) {
    VM.update(vm_uuid, {'quota': 0}, function(err) {
        if (err) {
            t.ok(false, 'error updating VM: ' + err.message);
            t.end();
        } else {
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                    t.end();
                } else if (obj.quota !== 0) {
                    t.ok(false, 'VM has ' + obj.quota + ' != 0');
                    t.end();
                } else {
                    execFile('/usr/sbin/zfs', ['get', '-H', '-o', 'value', 'quota', obj.zonepath.substr(1)],
                        function (error, stdout, stderr) {
                            var res;
                            if (error) {
                                t.ok(false, 'Failed to get quota from zfs: ' + e.message);
                            } else {
                                res = stdout.replace(new RegExp("[\\s]+$", "g"), "");
                                t.ok(res === 'none', 'updated quota now: ' + res + ' vs none');
                            }
                            t.end();
                        }
                    );
                }
            });
        }
    });
});

function test_update_ram(ram)
{
    test('update ram ' + ram, function(t) {
        VM.update(vm_uuid, {'ram': ram}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                    }

                    t.ok((obj.ram === ram), 'vm.ram: ' + obj.ram + ' expected: ' + ram);
                    t.ok((obj.max_physical_memory === (ram + VM.KVM_MEM_OVERHEAD)), 'vm.max_physical_memory: '
                        + obj.max_physical_memory + ' expected: ' + (ram + VM.KVM_MEM_OVERHEAD));
                    t.ok((obj.max_locked_memory === (ram + VM.KVM_MEM_OVERHEAD)), 'vm.max_locked_memory: '
                        + obj.max_locked_memory + ' expected: ' + (ram + VM.KVM_MEM_OVERHEAD));
                    t.ok((obj.max_swap === (ram + VM.KVM_MEM_OVERHEAD)), 'vm.max_swap: '
                        + obj.max_swap + ' expected: ' + (ram + VM.KVM_MEM_OVERHEAD));
                    t.end();
                });
            }
        });
    });
}

// We started at 256, double that
test_update_ram(512);
// Update to a lower value should lower everything...
test_update_ram(128);
// Now something bigger
test_update_ram(1024);

// now try *just* updating swap
test('update max_swap', function(t) {
    var test_value = 2560;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        VM.update(vm_uuid, {'max_swap': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + test_value);
                    t.ok((obj.max_physical_memory == before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.max_locked_memory == before_obj.max_locked_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_locked_memory);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating swap, and to a lower than RAM.
test('update max_swap', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = (before_obj.max_physical_memory - 64);
        VM.update(vm_uuid, {'max_swap': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }

                    // We expect that it was raised to match max_physical_memory
                    t.ok((obj.max_swap === before_obj.max_physical_memory),
                        'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.max_physical_memory == before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.ok((obj.max_locked_memory == before_obj.max_locked_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_locked_memory);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating max_physical_memory to a value: ram + 256
test('update max_physical_memory', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.ram + 256;
        VM.update(vm_uuid, {'max_physical_memory': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }

                    // everything else should have been lowered to match too
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + test_value);
                    t.ok((obj.max_physical_memory === test_value),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + test_value);
                    t.ok((obj.max_locked_memory === test_value),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + test_value);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating max_physical_memory to a value: ram + 1024
test('update max_physical_memory', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.ram + 1024;
        VM.update(vm_uuid, {'max_physical_memory': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }

                    // everything else should have been lowered to match too
                    t.ok((obj.max_swap === test_value), 'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + test_value);
                    t.ok((obj.max_physical_memory === test_value),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + test_value);
                    t.ok((obj.max_locked_memory === test_value),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + test_value);
                    t.end();
                });
            }
        });
    });
});

// now try *just* updating max_swap to a value: ram - 64
test('update max_swap', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.ram - 64;
        VM.update(vm_uuid, {'max_swap': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
                return;
            }
            VM.load(vm_uuid, function (err, obj) {
                if (err) {
                    t.ok(false, 'failed reloading VM');
                    t.end();
                    return;
                }
                // should have been raised.
                t.ok((obj.max_swap === before_obj.max_physical_memory),
                    'vm.max_swap: ' + obj.max_swap + ' expected: '
                    + before_obj.max_physical_memory);
                t.end();
            });
        });
    });
});

// now try *just* updating max_locked_memory, high value (should get clamped)
test('update max_locked_memory', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        test_value = before_obj.max_physical_memory + 256;
        VM.update(vm_uuid, {'max_locked_memory': test_value}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }
                    t.ok((obj.max_swap === before_obj.max_swap), 'vm.max_swap: ' + obj.max_swap
                        + ' expected: ' + before_obj.max_swap);
                    t.ok((obj.max_physical_memory == before_obj.max_physical_memory),
                        'vm.max_physical_memory: ' + obj.max_physical_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    // should have been clamped
                    t.ok((obj.max_locked_memory == before_obj.max_physical_memory),
                        'vm.max_locked_memory: ' + obj.max_locked_memory
                        + ' expected: ' + before_obj.max_physical_memory);
                    t.end();
                });
            }
        });
    });
});

// setting vnc_port=-1 should disable VNC
test('set vnc_port=-1', function(t) {
    var test_value;

    VM.load(vm_uuid, function (err, before_obj) {
        if (err) {
            t.ok(false, 'error loading existing VM: ' + err.message);
            t.end();
            return;
        }
        VM.update(vm_uuid, {'vnc_port': -1}, function(err) {
            if (err) {
                t.ok(false, 'error updating VM: ' + err.message);
                t.end();
            } else {
                VM.load(vm_uuid, function (err, obj) {
                    if (err) {
                        t.ok(false, 'failed reloading VM');
                        t.end();
                        return;
                    }
                    t.ok((obj.vnc_port === -1), 'vm.vnc_port: ' + obj.vnc_port
                        + ' expected: ' + -1);
                    t.end();
                });
            }
        });
    });
});

function zfs(args, callback)
{
    var cmd = '/usr/sbin/zfs';

    execFile(cmd, args, function (error, stdout, stderr) {
        if (error) {
            callback(error, {'stdout': stdout, 'stderr': stderr});
        } else {
            callback(null, {'stdout': stdout, 'stderr': stderr});
        }
    });
}

// VM should at this point be running, so removing the disk should fail.
// Stopping and removing should succeed.
// Adding should also succeed at that point.
test('remove disk', function(t) {
    VM.load(vm_uuid, function (err, vmobj) {
        var disk;

        if (err) {
            t.ok(false, 'error loading VM: ' + err.message);
            t.end();
            return;
        }
        if (vmobj.state !== 'running') {
            t.ok(false, 'VM is not running: ' + vmobj.state);
            t.end();
            return;
        }
        if (!vmobj.hasOwnProperty('disks') || vmobj.disks.length !== 1) {
            t.ok(false, 'cannot find disk: ' + vmobj.disks);
            t.end();
            return;
        }
        disk = vmobj.disks[0];
        t.ok(disk.hasOwnProperty('path'), 'disk has a path: ' + disk.path);
        VM.update(vmobj.uuid, {'remove_disks': [disk.path]}, function (err) {
            // expect an error
            t.ok(err, 'VM.update failed to remove disks: ' + (err ? err.message : err));
            if (!err) {
                t.end();
                return;
            }
            VM.stop(vmobj.uuid, {'force': true}, function (err) {
                t.ok(!err, 'VM.stop');
                if (!err) {
                    VM.load(vm_uuid, function (err, obj) {
                        t.ok(!err, 'loaded VM after stop');
                        t.ok(obj.state === 'stopped', 'VM is stopped.');
                        if (obj.state === 'stopped') {
                            // same update
                            VM.update(vmobj.uuid, {'remove_disks': [disk.path]}, function (err) {
                                t.ok(!err, 'removed disk: ' + (err ? err.message : err));
                                // check that zfs filesystem is gone, also
                                // reload and check that disk is no longer in list
                                zfs(['list', disk.zfs_filesystem], function (err, fds) {
                                    t.ok(err
                                        && err.hasOwnProperty('message')
                                        && err.message.match('dataset does not exist'),
                                        'ensure dataset no longer exists');
                                    VM.load(vmobj.uuid, function (err, final_obj) {
                                        t.ok(!err, 'loaded VM after delete');
                                        t.ok(final_obj.disks.length === 0, 'disks list empty: '
                                            + JSON.stringify(final_obj.disks));
                                        t.end();
                                    });
                                });
                            });
                        } else {
                            t.end();
                        }
                    });
                } else {
                    t.end();
                }
            });
        });
    });
});

test('delete zone', function(t) {
    if (vm_uuid) {
        VM.delete(vm_uuid, function (err) {
            if (err) {
                t.ok(false, 'error deleting VM: ' + err.message);
            } else {
                t.ok(true, 'deleted VM: ' + vm_uuid);
            }
            t.end();
        });
    } else {
        t.ok(false, 'no VM to delete');
        t.end();
    }
});
