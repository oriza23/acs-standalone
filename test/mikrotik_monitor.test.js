const assert = require('node:assert/strict');
const test = require('node:test');
const {
  parseResource,
  parseCount,
  parseTraffic,
  parseInterfaces,
  normalizeCredentials,
  collectSample,
  createMikrotikMonitor,
} = require('../backend/mikrotikMonitor');

test('resource mengubah cpu-load dan memori menjadi persen', () => {
  const parsed = parseResource([{
    'cpu-load': '23',
    'free-memory': '600',
    'total-memory': '1000',
    'board-name': 'RB750',
    version: '7.15',
  }]);
  assert.equal(parsed.cpu, 23);
  assert.equal(parsed.ramPercent, 40);
  assert.equal(parsed.ramUsed, 400);
  assert.equal(parsed.board, 'RB750');
});

test('count-only membaca ret dan print biasa dihitung dari array', () => {
  assert.equal(parseCount([{ ret: '12' }]), 12);
  assert.equal(parseCount([{ '.id': '*1' }, { '.id': '*2' }]), 2);
  assert.equal(parseCount([]), 0);
});

test('traffic membaca rx dan tx bits per second', () => {
  const traffic = parseTraffic([{
    'rx-bits-per-second': '1500',
    'tx-bits-per-second': '2500',
  }]);
  assert.deepEqual(traffic, { rx: 1500, tx: 2500 });
});

test('kredensial menolak interface yang tidak aman dan mengisi ether1', () => {
  assert.throws(() => normalizeCredentials({
    username: 'admin',
    password: 'rahasia',
    interface: 'ether1; /system',
  }), /interface/);
  const creds = normalizeCredentials({ username: 'admin', password: 'rahasia' });
  assert.equal(creds.iface, 'ether1');
  assert.equal(creds.port, 8728);
});

test('sampel memakai resource, count-only, dan monitor-traffic sekali', async () => {
  const commands = [];
  const client = {
    write: async (command, params = []) => {
      commands.push([command, ...params]);
      if (command === '/system/resource/print') {
        return [{ 'cpu-load': '10', 'total-memory': '100', 'free-memory': '40' }];
      }
      if (command === '/ppp/active/print') {
        return [{ ret: '3' }];
      }
      if (command === '/ip/hotspot/active/print') {
        return [{ ret: '1' }];
      }
      return [{ 'rx-bits-per-second': '8000', 'tx-bits-per-second': '16000' }];
    },
  };

  const sample = await collectSample(client, 'ether1');
  assert.equal(sample.cpu, 10);
  assert.equal(sample.pppoe, 3);
  assert.equal(sample.hotspot, 1);
  assert.equal(sample.rx, 8000);
  assert.equal(sample.tx, 16000);
  assert.deepEqual(commands[1], ['/ppp/active/print', '=count-only=']);
  assert.deepEqual(commands[3], ['/interface/monitor-traffic', '=interface=ether1', '=once=']);
});

test('daftar interface memakai nama dan menolak perintah sisipan', () => {
  assert.deepEqual(parseInterfaces([
    { name: 'ether1' },
    { name: '  bridge1  ' },
    { name: '<pppoe-user>' },
    { name: 'ether1' },
    { name: '' },
    { name: 'ether1=once' },
  ]), ['ether1', 'bridge1', '<pppoe-user>']);
});

test('setInterface mengganti target trafik ke nama yang ada di router', async () => {
  const commands = [];
  const client = {
    connected: true,
    close: async () => {},
    write: async (command, params = []) => {
      commands.push([command, ...params]);
      if (command === '/interface/print') {
        return [{ name: 'ether1' }, { name: '<pppoe-user>' }];
      }
      if (command === '/system/resource/print') {
        return [{ 'cpu-load': '10', 'total-memory': '100', 'free-memory': '40' }];
      }
      if (command.includes('monitor-traffic')) {
        return [{ 'rx-bits-per-second': '8000', 'tx-bits-per-second': '16000' }];
      }
      return [{ ret: '2' }];
    },
  };
  const monitor = createMikrotikMonitor({ createClient: async () => client });
  const lists = [];
  monitor.onInterfaces = (names) => lists.push(names);
  try {
    monitor.start({
      host: '10.0.0.1',
      user: 'admin',
      password: 'rahasia',
      port: 8728,
      iface: 'ether1',
    });
    assert.equal(monitor.setInterface('<pppoe-user>'), true);
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.deepEqual(lists[0], ['ether1', '<pppoe-user>']);
    assert.equal(commands.some((item) => item[0] === '/interface/print'), true);
    assert.equal(monitor.setInterface('ether9'), false);
    assert.equal(monitor.setInterface('ether1; /system'), false);
    const traffic = commands.filter((item) => item[0] === '/interface/monitor-traffic');
    assert.deepEqual(traffic[0], ['/interface/monitor-traffic', '=interface=<pppoe-user>', '=once=']);
  } finally {
    monitor.stop();
  }
});

test('monitor memancarkan sampel tanpa menyertakan password', async () => {
  const client = {
    connected: true,
    close: async () => {},
    write: async (command) => {
      if (command === '/system/resource/print') {
        return [{ 'cpu-load': '10', 'total-memory': '100', 'free-memory': '40' }];
      }
      if (command.includes('monitor-traffic')) {
        return [{ 'rx-bits-per-second': '8000', 'tx-bits-per-second': '16000' }];
      }
      return [{ ret: '2' }];
    },
  };
  const monitor = createMikrotikMonitor({ createClient: async () => client });
  const samples = [];
  monitor.onSample = (sample) => samples.push(sample);
  try {
    monitor.start({
      routerId: 4,
      routerName: 'Konter',
      host: '10.0.0.1',
      user: 'admin',
      password: 'jangan-bocor',
      port: 8728,
      iface: 'ether1',
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(samples[0].cpu, 10);
    assert.equal(samples[0].routerName, 'Konter');
    assert.equal(samples[0].password, undefined);
    assert.equal(JSON.stringify(samples[0]).includes('jangan-bocor'), false);
  } finally {
    monitor.stop();
  }
});
