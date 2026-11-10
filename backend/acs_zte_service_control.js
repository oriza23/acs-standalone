// ZTE Service Control (ACL) — level perangkat, bukan per instance WAN.
// Parameter utama (TR-098):
//   InternetGatewayDevice.X_ZTE-COM_Security.AclServices
//   InternetGatewayDevice.X_ZTE-COM_Security.IPv4RemoteServicePortControl.{i}.*
//
// Ditulis terpisah SETELAH konfigurasi WAN sukses agar tidak mengganggu SetParameterValues atomik PPP.
const acs = require('./acs');

function normalizeDeviceType(value) {
  const compact = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (compact === 'cmcc') {
    return 'chinamobile';
  }
  const types = ['zte', 'huawei', 'chinamobile', 'fiberhome'];
  return types.includes(compact) ? compact : '';
}

function vendorIsZte(manufacturer) {
  const text = String(manufacturer || '').toLowerCase();
  return text.includes('zte');
}

function enabledLabel(value) {
  if (value === undefined || value === null || value === '') {
    return '-';
  }
  if (value === true || value === 1) {
    return 'Enabled';
  }
  const text = String(value).trim().toLowerCase();
  if (text === '1' || text === 'true' || text === 'enabled') {
    return 'Enabled';
  }
  if (text === '0' || text === 'false' || text === 'disabled') {
    return 'Disabled';
  }
  return '-';
}

const IGD = 'InternetGatewayDevice';
const SEC = `${IGD}.X_ZTE-COM_Security`;
const ACL_PATH = process.env.ZTE_ACL_SERVICES_PATH || `${SEC}.AclServices`;
const ACL_TYPE = process.env.ZTE_ACL_SERVICES_TYPE || 'xsd:unsignedInt';
const PORT_INST = process.env.ZTE_IPV4_REMOTE_PORT_INDEX || '1';
const PORT_BASE = process.env.ZTE_IPV4_REMOTE_PORT_BASE || `${SEC}.IPv4RemoteServicePortControl.${PORT_INST}`;

function aclOnOff(on) {
  if (ACL_TYPE === 'xsd:boolean') {
    return on;
  }
  return on ? 1 : 0;
}

function push(list, path, value, type) {
  if (value === undefined || value === null) {
    return;
  }
  list.push([path, value, type]);
}

function buildZteServiceControlRows(enable) {
  const on = enable === true;
  const list = [];
  push(list, ACL_PATH, aclOnOff(on), ACL_TYPE);
  push(list, `${PORT_BASE}.Enable`, on, 'xsd:boolean');
  if (on) {
    // Akses ping/HTTP dari WAN — sesuaikan lewat env bila leaf firmware berbeda.
    const wanLeaf = process.env.ZTE_IPV4_REMOTE_WAN_ENABLE || 'WanEnable';
    const icmpLeaf = process.env.ZTE_IPV4_REMOTE_ICMP || 'ICMP';
    const httpLeaf = process.env.ZTE_IPV4_REMOTE_HTTP || 'HTTP';
    push(list, `${PORT_BASE}.${wanLeaf}`, true, 'xsd:boolean');
    if (process.env.ZTE_IPV4_REMOTE_SET_ICMP !== '0') {
      push(list, `${PORT_BASE}.${icmpLeaf}`, true, 'xsd:boolean');
    }
    if (process.env.ZTE_IPV4_REMOTE_SET_HTTP !== '0') {
      push(list, `${PORT_BASE}.${httpLeaf}`, true, 'xsd:boolean');
    }
  }
  return list;
}

function isZteServiceControlCandidate(values, manufacturer) {
  if (!values?.writeServiceControl) {
    return false;
  }
  const type = normalizeDeviceType(values?.deviceType);
  if (type === 'zte') {
    return true;
  }
  return vendorIsZte(manufacturer || values?.manufacturer);
}

async function applyZteServiceControl(server, deviceId, values, manufacturer) {
  if (!isZteServiceControlCandidate(values, manufacturer)) {
    return { skipped: true, applied: false, partial: false };
  }
  const rows = buildZteServiceControlRows(values.enableServiceControl === true);
  if (rows.length === 0) {
    return { skipped: true, applied: false, partial: false };
  }
  try {
    await acs.sendSetParameterValues(server, deviceId, rows);
    return { applied: true, partial: false, message: '' };
  } catch (error) {
    const detail = error?.message || String(error);
    return {
      applied: false,
      partial: true,
      message: `Service Control (ACL ZTE) tidak diterapkan: ${detail}`,
    };
  }
}

function readAclServicesValue(sec) {
  if (!sec || typeof sec !== 'object') {
    return undefined;
  }
  const acl = sec.AclServices;
  if (acl && typeof acl === 'object' && Object.hasOwn(acl, '_value')) {
    return acl._value;
  }
  if (acl?.Enable && Object.hasOwn(acl.Enable, '_value')) {
    return acl.Enable._value;
  }
  return undefined;
}

function extractZteAclServiceControl(item) {
  const sec = item?.InternetGatewayDevice?.['X_ZTE-COM_Security'];
  const aclVal = readAclServicesValue(sec);
  if (aclVal !== undefined && aclVal !== null && aclVal !== '') {
    return enabledLabel(aclVal);
  }
  const portEnable = sec?.IPv4RemoteServicePortControl?.[PORT_INST]?.Enable?._value
    ?? sec?.IPv4RemoteServicePortControl?.[1]?.Enable?._value;
  if (portEnable !== undefined && portEnable !== null && portEnable !== '') {
    return enabledLabel(portEnable);
  }
  return '-';
}

module.exports = {
  ACL_PATH,
  PORT_BASE,
  buildZteServiceControlRows,
  applyZteServiceControl,
  extractZteAclServiceControl,
  isZteServiceControlCandidate,
};
