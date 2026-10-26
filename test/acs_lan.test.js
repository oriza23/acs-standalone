const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLanUpdate, planLanUpdate, maskToInt, ipToInt } = require('../backend/acs_lan');

const ok = {
  deviceId: 'ONU-1', ip: '192.168.1.1', subnet: '255.255.255.0', dhcpEnabled: true,
  dhcpMin: '192.168.1.2', dhcpMax: '192.168.1.254', leaseTime: '86400', dns1: '8.8.8.8', dns2: '', dns3: '1.1.1.1',
};
const v = (value) => ({ _value: value });
const B = 'InternetGatewayDevice.LANDevice.1.LANHostConfigManagement';

test('parseLanUpdate: input valid, DNS digabung & kosong dibuang, lease jadi angka', () => {
  assert.deepEqual(parseLanUpdate(ok).value, {
    deviceId: 'ONU-1', ip: '192.168.1.1', subnet: '255.255.255.0', dhcpEnabled: true,
    dhcpMin: '192.168.1.2', dhcpMax: '192.168.1.254', leaseTime: 86400, dnsServers: '8.8.8.8,1.1.1.1',
  });
  assert.equal(parseLanUpdate({ ...ok, dns1: '', dns2: '', dns3: '' }).value.dnsServers, '');
  assert.equal(parseLanUpdate({ ...ok, dns1: '8.8.8.8', dns2: '8.8.8.8' }).value.dnsServers, '8.8.8.8,1.1.1.1', 'duplikat dibuang');
  assert.equal(parseLanUpdate({ ...ok, subnet: '255.255.0.0', dhcpMin: '192.168.2.10', dhcpMax: '192.168.200.20' }).error, undefined);
});

test('parseLanUpdate: DHCP mati -> rentang & lease diabaikan (tidak divalidasi)', () => {
  const result = parseLanUpdate({ ...ok, dhcpEnabled: false, dhcpMin: 'sampah', dhcpMax: '', leaseTime: 'x' });
  assert.deepEqual([result.error, result.value.dhcpMin, result.value.leaseTime], [undefined, '', null]);
});

test('parseLanUpdate: IP Gateway & Subnet Mask', () => {
  const bad = (override) => parseLanUpdate({ ...ok, ...override }).error;
  assert.ok(bad({ ip: '' }));
  assert.ok(bad({ ip: '256.1.1.1' }));
  assert.ok(bad({ ip: '0.0.0.0' }));
  assert.ok(bad({ ip: '127.0.0.1' }));
  assert.ok(bad({ ip: '224.0.0.1' }), 'multicast');
  assert.ok(bad({ ip: '192.168.1.0' }), 'alamat network');
  assert.ok(bad({ ip: '192.168.1.255' }), 'alamat broadcast');
  assert.ok(bad({ ip: 1234 }));
  assert.ok(bad({ subnet: '255.0.255.0' }), 'mask tidak berurutan');
  assert.ok(bad({ subnet: '255.255.255.255' }), '/32');
  assert.ok(bad({ subnet: '255.255.255.254' }), '/31');
  assert.ok(bad({ subnet: '128.0.0.0' }), 'di bawah /8');
  assert.ok(bad({ subnet: '' }));
  assert.equal(bad({ subnet: '255.255.255.252', dhcpEnabled: false }), undefined, '/30 boleh bila DHCP mati');
});

test('parseLanUpdate: rentang DHCP & lease', () => {
  const bad = (override) => parseLanUpdate({ ...ok, ...override }).error;
  assert.ok(bad({ dhcpMin: '' }));
  assert.ok(bad({ dhcpMax: 'abc' }));
  assert.ok(bad({ dhcpMin: '192.168.2.10' }), 'di luar subnet');
  assert.ok(bad({ dhcpMax: '192.168.2.10' }), 'di luar subnet');
  assert.ok(bad({ dhcpMin: '192.168.1.0' }), 'alamat network');
  assert.ok(bad({ dhcpMax: '192.168.1.255' }), 'alamat broadcast');
  assert.ok(bad({ dhcpMin: '192.168.1.100', dhcpMax: '192.168.1.50' }), 'min > max');
  assert.ok(bad({ dhcpMin: '192.168.1.1', dhcpMax: '192.168.1.50' }), 'memuat IP gateway');
  assert.ok(bad({ dhcpMin: '192.168.1.2', dhcpMax: '192.168.1.254', ip: '192.168.1.100' }), 'gateway di tengah pool');
  assert.ok(bad({ leaseTime: '59' }));
  assert.ok(bad({ leaseTime: '31536001' }));
  assert.ok(bad({ leaseTime: '12.5' }));
  assert.ok(bad({ leaseTime: 'abc' }));
  assert.ok(bad({ leaseTime: '' }));
  assert.equal(bad({ leaseTime: 3600 }), undefined);
});

test('parseLanUpdate: DNS, status DHCP, dan deviceId', () => {
  const bad = (override) => parseLanUpdate({ ...ok, ...override }).error;
  assert.ok(bad({ dns1: 'dns.google' }));
  assert.ok(bad({ dns2: '999.1.1.1' }));
  assert.ok(bad({ dns3: '0.0.0.0' }));
  assert.ok(bad({ dhcpEnabled: 'true' }), 'harus boolean sungguhan');
  assert.ok(bad({ dhcpEnabled: undefined }));
  assert.ok(bad({ deviceId: '' }));
  assert.ok(parseLanUpdate(null).error);
});

test('helper IP: ipToInt & maskToInt', () => {
  assert.equal(ipToInt('192.168.1.1'), 3232235777);
  assert.equal(ipToInt('1.2.3'), null);
  assert.equal(maskToInt('255.255.255.0'), 4294967040);
  assert.equal(maskToInt('255.255.254.0') !== null, true);
  assert.equal(maskToInt('255.0.255.0'), null);
});

test('planLanUpdate: hanya yang berubah, tipe XSD benar, IP/subnet lebih dulu', () => {
  const node = {
    IPInterface: { 1: { IPInterfaceIPAddress: v('192.168.0.1'), IPInterfaceSubnetMask: v('255.255.255.0') } },
    DHCPServerEnable: v('0'), MinAddress: v('192.168.0.2'), MaxAddress: v('192.168.0.254'), DHCPLeaseTime: v('43200'), DNSServers: v('8.8.8.8'),
  };
  const { parameterValues, changed } = planLanUpdate({ lanNode: node, values: parseLanUpdate(ok).value });
  assert.deepEqual(parameterValues, [
    [`${B}.IPInterface.1.IPInterfaceIPAddress`, '192.168.1.1', 'xsd:string'],
    [`${B}.IPRouters`, '192.168.1.1', 'xsd:string'],
    [`${B}.DHCPServerEnable`, true, 'xsd:boolean'],
    [`${B}.MinAddress`, '192.168.1.2', 'xsd:string'],
    [`${B}.MaxAddress`, '192.168.1.254', 'xsd:string'],
    [`${B}.DHCPLeaseTime`, 86400, 'xsd:unsignedInt'],
    [`${B}.DNSServers`, '8.8.8.8,1.1.1.1', 'xsd:string'],
  ]);
  assert.deepEqual(changed, ['ip', 'ipRouters', 'dhcpEnabled', 'dhcpMin', 'dhcpMax', 'leaseTime', 'dns']);
});

test('planLanUpdate: IPRouters ikut IP gateway, dan tetap dikirim bila gateway DHCP tertinggal', () => {
  const sameIp = {
    IPInterface: { 1: { IPInterfaceIPAddress: v('192.168.1.1'), IPInterfaceSubnetMask: v('255.255.255.0') } },
    IPRouters: v('192.168.0.1'),
    DHCPServerEnable: v(true), MinAddress: v('192.168.1.2'), MaxAddress: v('192.168.1.254'), DHCPLeaseTime: v(86400), DNSServers: v('8.8.8.8,1.1.1.1'),
  };
  assert.deepEqual(planLanUpdate({ lanNode: sameIp, values: parseLanUpdate(ok).value }).parameterValues, [
    [`${B}.IPRouters`, '192.168.1.1', 'xsd:string'],
  ]);

  const already = { ...sameIp, IPRouters: v('192.168.1.1') };
  assert.deepEqual(planLanUpdate({ lanNode: already, values: parseLanUpdate(ok).value }), { parameterValues: [], changed: [] });
});

test('planLanUpdate: tanpa perubahan -> kosong; DNS dibandingkan tanpa peduli spasi', () => {
  const node = {
    IPInterface: { 1: { IPInterfaceIPAddress: v('192.168.1.1'), IPInterfaceSubnetMask: v('255.255.255.0') } },
    DHCPServerEnable: v(true), MinAddress: v('192.168.1.2'), MaxAddress: v('192.168.1.254'), DHCPLeaseTime: v(86400), DNSServers: v('8.8.8.8, 1.1.1.1'),
  };
  assert.deepEqual(planLanUpdate({ lanNode: node, values: parseLanUpdate(ok).value }), { parameterValues: [], changed: [] });
});

test('planLanUpdate: DHCP dimatikan hanya mengirim Enable=false, rentang tidak disentuh', () => {
  const node = {
    IPInterface: { 1: { IPInterfaceIPAddress: v('192.168.1.1'), IPInterfaceSubnetMask: v('255.255.255.0') } },
    DHCPServerEnable: v(true), MinAddress: v('192.168.1.2'), MaxAddress: v('192.168.1.254'), DHCPLeaseTime: v(86400), DNSServers: v('8.8.8.8,1.1.1.1'),
  };
  const values = parseLanUpdate({ ...ok, dhcpEnabled: false }).value;
  assert.deepEqual(planLanUpdate({ lanNode: node, values }).parameterValues, [[`${B}.DHCPServerEnable`, false, 'xsd:boolean']]);
});

test('planLanUpdate: DNS dikosongkan dikirim sebagai string kosong bila sebelumnya terisi', () => {
  const node = {
    IPInterface: { 1: { IPInterfaceIPAddress: v('192.168.1.1'), IPInterfaceSubnetMask: v('255.255.255.0') } },
    DHCPServerEnable: v(true), MinAddress: v('192.168.1.2'), MaxAddress: v('192.168.1.254'), DHCPLeaseTime: v(86400), DNSServers: v('8.8.8.8'),
  };
  const values = parseLanUpdate({ ...ok, dns1: '', dns3: '' }).value;
  assert.deepEqual(planLanUpdate({ lanNode: node, values }).parameterValues, [[`${B}.DNSServers`, '', 'xsd:string']]);
});
