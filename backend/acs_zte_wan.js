// Adapter untuk POST /api/acs/zte/wan: input ringkas khusus ZTE -> body form WAN PPP yang dipakai alur
// runWan (acs_wan_flow.js). Seluruh eksekusi TR-069 (AddObject WANConnectionDevice, AddObject
// WANPPPConnection, SetParameterValues atomik, rollback, deteksi fault) tetap satu jalur dengan form UI.
//
// Nilai ZTE di bawah diukur pada 35 ONU ZTE F609 di GenieACS (bukan asumsi):
//   - PPPoE  : WANPPPConnection, ConnectionType = IP_Routed
//   - Bridge : WANPPPConnection, ConnectionType = PPPoE_Bridged (tidak ada WANIPConnection bridge)
//   - VLAN   : X_ZTE-COM_VLANEnable (unsignedInt 1), X_ZTE-COM_VLANID, X_ZTE-COM_8021P
//   - Binding: X_ZTE-COM_LanInterface = daftar path TR-098 dipisah koma
//   - Layanan: X_ZTE-COM_ServiceList = INTERNET
const { selectedLanInterfaces } = require('./acs_wan');

const ZTE_WAN_TYPES = {
  pppoe: 'IP_Routed',
  bridge: 'PPPoE_Bridged',
};

const PORT_LABEL = /^(?:LAN[1-4]|SSID[1-8])$/;

// ['LAN1', 'ssid1'] atau "LAN1,SSID1" -> ['LAN1', 'SSID1'] (huruf besar, tanpa duplikat).
function normalizePortLabels(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { labels: [] };
  }
  const items = typeof raw === 'string' ? raw.split(/[\s,;]+/).filter(Boolean) : raw;
  if (!Array.isArray(items)) {
    return { error: 'ports harus berupa array, mis. ["LAN1","SSID1"]' };
  }
  const labels = [];
  for (const item of items) {
    const label = typeof item === 'string' ? item.trim().toUpperCase() : '';
    if (!PORT_LABEL.test(label)) {
      return { error: `Port binding tidak valid: ${JSON.stringify(item)}. Gunakan LAN1-LAN4 atau SSID1-SSID8` };
    }
    if (!labels.includes(label)) {
      labels.push(label);
    }
  }
  return { labels };
}

// Label port -> string yang ditulis ke X_ZTE-COM_LanInterface.
// ['LAN1','SSID1'] -> "InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.1,InternetGatewayDevice.LANDevice.1.WLANConfiguration.1"
function zteBindingString(labels) {
  const ports = {};
  for (const label of labels) {
    ports[label.toLowerCase()] = true;
  }
  return selectedLanInterfaces(ports);
}

function optionalBoolean(value, fallback, field) {
  if (value === undefined || value === null) {
    return { value: fallback };
  }
  return typeof value === 'boolean' ? { value } : { error: `${field} harus berupa true atau false` };
}

// Body request:
//   { server_id, deviceId, type: 'pppoe' | 'bridge', name, username?, password?,
//     vlanId?, priority?, serviceList?, enable?, nat?, enableServiceControl?, ports? }
// Mengembalikan { error } atau { type, labels, body } (body = input parseWanPpp dengan deviceType zte).
// Validasi mendalam (panjang, rentang VLAN, karakter kontrol) tetap dilakukan parseWanPpp.
function parseZteWanRequest(input) {
  const source = input && typeof input === 'object' ? input : {};
  const type = typeof source.type === 'string' ? source.type.trim().toLowerCase() : '';
  if (!Object.hasOwn(ZTE_WAN_TYPES, type)) {
    return { error: 'type harus "pppoe" atau "bridge"' };
  }
  const pppoe = type === 'pppoe';

  const enable = optionalBoolean(source.enable, true, 'enable');
  if (enable.error) {
    return { error: enable.error };
  }
  const nat = optionalBoolean(source.nat, true, 'nat');
  if (nat.error) {
    return { error: nat.error };
  }
  const serviceControl = optionalBoolean(source.enableServiceControl, false, 'enableServiceControl');
  if (serviceControl.error) {
    return { error: serviceControl.error };
  }

  const ports = normalizePortLabels(source.ports);
  if (ports.error) {
    return { error: ports.error };
  }

  const hasVlan = source.vlanId !== undefined && source.vlanId !== null && String(source.vlanId).trim() !== '';
  const body = {
    server_id: source.server_id,
    deviceId: source.deviceId,
    deviceType: 'zte',
    connectionName: source.name,
    enableConnection: enable.value,
    // ONU menolak NAT pada bridge (CWMP 9003); alur inti juga memaksanya false.
    natStatus: pppoe ? nat.value : false,
    // Placeholder TR-069 ada di acs_wan.js (ZTE_SERVICE_CONTROL_LEAF).
    enableServiceControl: serviceControl.value,
    vlanStatus: hasVlan,
    ...(hasVlan ? { vlanId: source.vlanId } : {}),
    priority: source.priority ?? 0,
    serviceList: typeof source.serviceList === 'string' && source.serviceList.trim() ? source.serviceList.trim().toUpperCase() : 'INTERNET',
    connectionType: ZTE_WAN_TYPES[type],
    ports: ports.labels,
    ...(pppoe ? { username: source.username, password: source.password } : {}),
  };
  return { type, labels: ports.labels, body };
}

module.exports = {
  ZTE_WAN_TYPES,
  normalizePortLabels,
  zteBindingString,
  parseZteWanRequest,
};
