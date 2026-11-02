// Validasi permintaan "Update LAN" dan penyusunan parameterValues TR-069 (setParameterValues).
// Murni (tanpa jaringan/DB) supaya mudah dites. Salah ubah konfigurasi LAN bisa memutus akses ke ONU,
// jadi validasinya sengaja ketat (IP dalam subnet, rentang DHCP konsisten).

const IGD = 'InternetGatewayDevice';
const LAN_BASE = `${IGD}.LANDevice.1.LANHostConfigManagement`;
const LEASE_MIN = 60;
const LEASE_MAX = 31536000; // 1 tahun

function isNode(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asBoolean(value) {
  if (value === true || value === 1) {
    return true;
  }
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return text === 'true' || text === '1';
}

const IPV4 = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

// "192.168.1.1" -> angka 32-bit tanpa tanda; null bila bukan IPv4 valid.
function ipToInt(value) {
  if (typeof value !== 'string' || !IPV4.test(value.trim())) {
    return null;
  }
  return value.trim().split('.').reduce((total, octet) => (total * 256) + Number(octet), 0);
}

// Mask valid: bit 1 berurutan dari kiri, prefix 8-30 (LAN rumahan/kantor). Mengembalikan angka mask atau null.
function maskToInt(value) {
  const mask = ipToInt(value);
  if (mask === null) {
    return null;
  }
  const inverted = (~mask) >>> 0;
  const contiguous = ((inverted + 1) & inverted) === 0; // invers = 2^n - 1
  const prefix = 32 - Math.log2(inverted + 1);
  return contiguous && prefix >= 8 && prefix <= 30 ? mask : null;
}

function isUsableHost(ip) {
  const first = Math.floor(ip / 2 ** 24);
  return first >= 1 && first <= 223 && first !== 127;
}

// Membaca & memvalidasi body. Hasil: { error } atau { value }.
function parseLanUpdate(body) {
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  if (!deviceId || deviceId.length > 255) {
    return { error: 'ID perangkat tidak valid' };
  }

  const ip = ipToInt(body?.ip);
  if (ip === null || !isUsableHost(ip)) {
    return { error: 'IP Gateway tidak valid' };
  }
  const mask = maskToInt(body?.subnet);
  if (mask === null) {
    return { error: 'Subnet Mask tidak valid (prefix harus /8 sampai /30)' };
  }
  const network = (ip & mask) >>> 0;
  const broadcast = (network | ((~mask) >>> 0)) >>> 0;
  if (ip === network || ip === broadcast) {
    return { error: 'IP Gateway tidak boleh berupa alamat network atau broadcast subnet' };
  }

  if (typeof body?.dhcpEnabled !== 'boolean') {
    return { error: 'DHCP Server harus berupa true (aktif) atau false (mati)' };
  }

  let dhcpMin = '';
  let dhcpMax = '';
  let leaseTime = null;
  if (body.dhcpEnabled) {
    const min = ipToInt(body?.dhcpMin);
    const max = ipToInt(body?.dhcpMax);
    if (min === null || max === null) {
      return { error: 'DHCP Start IP dan End IP wajib berupa IPv4 valid' };
    }
    if (min <= network || max >= broadcast || ((min & mask) >>> 0) !== network || ((max & mask) >>> 0) !== network) {
      return { error: 'Rentang DHCP harus berada di dalam subnet IP Gateway' };
    }
    if (min > max) {
      return { error: 'DHCP Start IP tidak boleh lebih besar dari End IP' };
    }
    if (ip >= min && ip <= max) {
      return { error: 'Rentang DHCP tidak boleh memuat IP Gateway' };
    }
    const lease = Number(String(body?.leaseTime ?? '').trim());
    if (!Number.isInteger(lease) || lease < LEASE_MIN || lease > LEASE_MAX) {
      return { error: `Lease Time harus bilangan bulat ${LEASE_MIN}-${LEASE_MAX} detik` };
    }
    dhcpMin = body.dhcpMin.trim();
    dhcpMax = body.dhcpMax.trim();
    leaseTime = lease;
  }

  const dns = [];
  for (const field of ['dns1', 'dns2', 'dns3']) {
    const raw = body?.[field];
    if (raw === undefined || raw === null || raw === '') {
      continue;
    }
    const value = ipToInt(raw);
    if (value === null || value === 0) {
      return { error: `DNS ${field.slice(3)} bukan IPv4 yang valid` };
    }
    if (!dns.includes(raw.trim())) {
      dns.push(raw.trim());
    }
  }

  return {
    value: {
      deviceId,
      ip: body.ip.trim(),
      subnet: body.subnet.trim(),
      dhcpEnabled: body.dhcpEnabled,
      dhcpMin,
      dhcpMax,
      leaseTime,
      dnsServers: dns.join(','),
    },
  };
}

function normalizeDns(value) {
  return String(value ?? '').split(',').map((entry) => entry.trim()).filter(Boolean).join(',');
}

// Menyusun parameterValues ([path, nilai, tipe]) hanya untuk yang berubah dari konfigurasi saat ini
// (lanNode = node LANHostConfigManagement dari GenieACS). IP/subnet lebih dulu supaya rentang DHCP baru
// dinilai terhadap subnet baru. Bila DHCP dimatikan, rentang dan lease tidak disentuh.
function planLanUpdate({ lanNode, values }) {
  const parameterValues = [];
  const changed = [];
  const push = (field, path, value, type, current) => {
    if (current !== value) {
      parameterValues.push([path, value, type]);
      changed.push(field);
    }
  };
  const interfaceNode = lanNode?.IPInterface?.[1];
  const currentIp = interfaceNode?.IPInterfaceIPAddress?._value;
  const currentRouters = lanNode?.IPRouters?._value;
  const ipChanged = currentIp !== values.ip;
  const routersKnown = currentRouters !== undefined && currentRouters !== null;
  const routersDiffer = routersKnown && String(currentRouters).trim() !== values.ip;
  // IP LAN dan gateway DHCP harus satu SetParameterValues. ONT ZTE memperbarui IP
  // antarmuka tanpa mengubah opsi router DHCP bila IPRouters tidak ada di payload yang sama.
  if (ipChanged || routersDiffer) {
    parameterValues.push([`${LAN_BASE}.IPInterface.1.IPInterfaceIPAddress`, values.ip, 'xsd:string']);
    parameterValues.push([`${LAN_BASE}.IPRouters`, values.ip, 'xsd:string']);
    if (ipChanged) {
      changed.push('ip');
    }
    changed.push('ipRouters');
  }
  push('subnet', `${LAN_BASE}.IPInterface.1.IPInterfaceSubnetMask`, values.subnet, 'xsd:string', interfaceNode?.IPInterfaceSubnetMask?._value);
  push('dhcpEnabled', `${LAN_BASE}.DHCPServerEnable`, values.dhcpEnabled, 'xsd:boolean',
    lanNode?.DHCPServerEnable === undefined ? undefined : asBoolean(lanNode.DHCPServerEnable._value));
  if (values.dhcpEnabled) {
    push('dhcpMin', `${LAN_BASE}.MinAddress`, values.dhcpMin, 'xsd:string', lanNode?.MinAddress?._value);
    push('dhcpMax', `${LAN_BASE}.MaxAddress`, values.dhcpMax, 'xsd:string', lanNode?.MaxAddress?._value);
    push('leaseTime', `${LAN_BASE}.DHCPLeaseTime`, values.leaseTime, 'xsd:unsignedInt', Number(lanNode?.DHCPLeaseTime?._value));
  }
  push('dns', `${LAN_BASE}.DNSServers`, values.dnsServers, 'xsd:string', normalizeDns(lanNode?.DNSServers?._value));

  return { parameterValues, changed };
}

module.exports = {
  parseLanUpdate,
  planLanUpdate,
  ipToInt,
  maskToInt,
  isNode,
};
