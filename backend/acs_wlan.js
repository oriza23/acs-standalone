// Validasi permintaan "Update WLAN" dan penyusunan parameterValues TR-069 (setParameterValues).
// Murni (tanpa jaringan/DB) supaya mudah dites.

const IGD = 'InternetGatewayDevice';
const MAX_WLAN_ID = 16;
const SSID_MAX_BYTES = 32; // standar 802.11: SSID maksimal 32 oktet
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 63; // batas passphrase WPA/WPA2 (UI membatasi lebih ketat: 8-20)

// Nilai BeaconType / mode mentah -> label yang sama dengan form.
// Harus selaras dengan securityLabel di frontend dan securityTr098 di acs_summary.js.
const SECURITY_LABELS = {
  '11i': 'WPA2-PSK',
  WPA: 'WPA-PSK',
  WPAand11i: 'WPA/WPA2-PSK',
  'WPA2-Personal': 'WPA2-PSK',
  'WPA-Personal': 'WPA-PSK',
  'WPA-WPA2-Personal': 'WPA/WPA2-PSK',
  None: 'Open System',
  Basic: 'Open System',
  'Open System': 'Open System',
};

const KNOWN_SECURITY = new Set([
  'WPA/WPA2-PSK',
  'WPA2-PSK',
  'WPA-PSK',
  'WPA2-Personal',
  'WPA-Personal',
  'WPA-WPA2-Personal',
  '11i',
  'WPA',
  'WPAand11i',
  'Open System',
  'None',
]);

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

function textOf(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function isOpenSecurity(security) {
  return security === 'Open System' || security === 'None';
}

// Mode dari body. Kosong = jangan ubah keamanan (kompatibel dengan klien lama).
// Nilai di luar daftar dikenal tetap diterima bila berupa token aman, supaya SSID
// tetap bisa disimpan saat ONU melaporkan mode yang tidak ada di daftar (mis. WEP).
function readSecurity(body) {
  if (body?.security === undefined || body?.security === null || body?.security === '') {
    return { security: '' };
  }
  if (typeof body.security !== 'string') {
    return { error: 'Mode keamanan tidak valid' };
  }
  const security = body.security.trim();
  if (!security) {
    return { security: '' };
  }
  if (!KNOWN_SECURITY.has(security) && (security.length > 64 || !/^[A-Za-z0-9][A-Za-z0-9 ./+_-]{0,63}$/.test(security))) {
    return { error: 'Mode keamanan tidak valid' };
  }
  return { security };
}

// BeaconType + BasicEncryptionModes untuk label form.
// Open/None -> None. WPA2 tetap 11i. Campuran WPA/WPA2 (dan label lain yang memuat "WPA") -> WPAand11i.
function tr098Security(security) {
  let beaconType = '11i';
  const basicEncryption = 'None';

  if (isOpenSecurity(security)) {
    beaconType = 'None';
  } else if (security === 'WPA2-PSK' || security === '11i' || security === 'WPA2-Personal') {
    beaconType = '11i';
  } else if (security === 'WPA-PSK' || security === 'WPA' || security === 'WPA-Personal') {
    beaconType = 'WPA';
  } else if (security.includes('WPA')) {
    beaconType = 'WPAand11i';
  }

  return { beaconType, basicEncryption };
}

// Label yang sama dengan yang ditampilkan form, dari node WLANConfiguration saat ini.
function currentSecurityLabel(wlanNode) {
  const beacon = textOf(wlanNode?.BeaconType?._value);
  let raw = '';
  if (beacon && beacon !== 'Basic') {
    raw = beacon;
  } else {
    const basic = textOf(wlanNode?.BasicEncryptionModes?._value);
    raw = basic && basic !== 'None' ? basic : 'Open System';
  }
  return SECURITY_LABELS[raw] ?? (raw || 'Open System');
}

// Membaca & memvalidasi body. Hasil: { error } atau { value }.
// wlanId dan nilai-nilai ini masuk ke path/nilai TR-069, jadi dibatasi ketat.
function parseWlanUpdate(body) {
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  if (!deviceId || deviceId.length > 255) {
    return { error: 'ID perangkat tidak valid' };
  }

  const wlanText = String(body?.wlanId ?? '').trim();
  const wlanNumber = Number(wlanText);
  if (!/^\d{1,2}$/.test(wlanText) || wlanNumber < 1 || wlanNumber > MAX_WLAN_ID) {
    return { error: `ID WLAN tidak valid (1-${MAX_WLAN_ID})` };
  }

  const ssid = body?.ssid;
  // eslint-disable-next-line no-control-regex
  if (typeof ssid !== 'string' || ssid.length === 0 || /[\u0000-\u001f\u007f]/.test(ssid)) {
    return { error: 'SSID wajib diisi dan tidak boleh berisi karakter kontrol' };
  }
  if (Buffer.byteLength(ssid, 'utf8') > SSID_MAX_BYTES) {
    return { error: `SSID maksimal ${SSID_MAX_BYTES} karakter` };
  }

  const securityResult = readSecurity(body);
  if (securityResult.error) {
    return securityResult;
  }
  const { security } = securityResult;
  const open = isOpenSecurity(security);

  // Password opsional: kosong = tidak diubah. Mode terbuka tidak memakai sandi.
  const rawPassword = body?.password;
  let password = '';
  if (!open && rawPassword !== undefined && rawPassword !== null && rawPassword !== '') {
    if (typeof rawPassword !== 'string' || !/^[\x20-\x7e]+$/.test(rawPassword)) {
      return { error: 'Password hanya boleh berisi karakter ASCII yang dapat dicetak' };
    }
    if (rawPassword.length < PASSWORD_MIN || rawPassword.length > PASSWORD_MAX) {
      return { error: `Password harus ${PASSWORD_MIN}-${PASSWORD_MAX} karakter` };
    }
    password = rawPassword;
  }

  if (typeof body?.status !== 'boolean') {
    return { error: 'Status harus berupa true (Enabled) atau false (Disabled)' };
  }

  return {
    value: {
      deviceId, wlanId: String(wlanNumber), ssid, password, status: body.status, security,
    },
  };
}

// Path parameter sandi yang benar-benar ada di ONU. Urutan: PreSharedKey.1.PreSharedKey (default),
// PreSharedKey.1.KeyPassphrase, KeyPassphrase. Tidak ada satu pun -> default.
function passwordPathFor(wlanId, wlanNode) {
  const base = `${IGD}.LANDevice.1.WLANConfiguration.${wlanId}`;
  const psk = wlanNode?.PreSharedKey?.[1];
  if (isNode(psk?.PreSharedKey) || !(isNode(psk?.KeyPassphrase) || isNode(wlanNode?.KeyPassphrase))) {
    return `${base}.PreSharedKey.1.PreSharedKey`;
  }
  return isNode(psk?.KeyPassphrase) ? `${base}.PreSharedKey.1.KeyPassphrase` : `${base}.KeyPassphrase`;
}

// Menyusun parameterValues ([path, nilai, tipe]) hanya untuk yang berubah dari konfigurasi saat ini
// (wlanNode = node WLANConfiguration.{id} dari GenieACS). changed berisi nama field, bukan nilainya.
// security kosong = jangan ubah mode. Mengembalikan { error } bila mode baru butuh sandi yang tidak ada.
function planWlanUpdate({
  wlanId, wlanNode, ssid, password, status, security = '', manufacturer = '',
}) {
  const base = `${IGD}.LANDevice.1.WLANConfiguration.${wlanId}`;
  const parameterValues = [];
  const changed = [];
  const open = isOpenSecurity(security);

  if (wlanNode?.SSID?._value !== ssid) {
    parameterValues.push([`${base}.SSID`, ssid, 'xsd:string']);
    changed.push('ssid');
  }
  if (asBoolean(wlanNode?.Enable?._value) !== status || wlanNode?.Enable === undefined) {
    parameterValues.push([`${base}.Enable`, status, 'xsd:boolean']);
    changed.push('status');
  }
  if (password && !open) {
    const path = passwordPathFor(wlanId, wlanNode);
    const currentPassword = path.endsWith('.PreSharedKey.1.PreSharedKey')
      ? wlanNode?.PreSharedKey?.[1]?.PreSharedKey?._value
      : (wlanNode?.PreSharedKey?.[1]?.KeyPassphrase?._value ?? wlanNode?.KeyPassphrase?._value);
    if (currentPassword !== password) {
      parameterValues.push([path, password, 'xsd:string']);
      changed.push('password');
    }
  }

  if (security) {
    const current = currentSecurityLabel(wlanNode);
    if (security !== current) {
      if (!KNOWN_SECURITY.has(security)) {
        return { error: 'Mode keamanan tidak didukung', parameterValues: [], changed: [] };
      }
      if (!open && isOpenSecurity(current) && !password) {
        return { error: 'Password wajib diisi untuk mode keamanan ini', parameterValues: [], changed: [] };
      }
      const { beaconType, basicEncryption } = tr098Security(security);
      parameterValues.push([`${base}.BeaconType`, beaconType, 'xsd:string']);
      changed.push('security');
      // Hanya dikirim bila ONU sudah memajang parameter ini. ONT yang tidak punya
      // BasicEncryptionModes menolak seluruh setParameterValues bila path-nya ikut.
      if (isNode(wlanNode?.BasicEncryptionModes) && textOf(wlanNode.BasicEncryptionModes._value) !== basicEncryption) {
        parameterValues.push([`${base}.BasicEncryptionModes`, basicEncryption, 'xsd:string']);
      }
    }
  }

  const result = { parameterValues, changed };
  // Fiberhome HG6145D2 (dan sejenis): mode 11i / WPAand11i menyimpan sandi di dua leaf.
  // Dipisah dari payload utama supaya ONU yang tidak punya leaf ini tidak menolak seluruh update.
  if (password && !open && isFiberhomeVendor(manufacturer)) {
    const beacon = security
      ? tr098Security(security).beaconType
      : textOf(wlanNode?.BeaconType?._value);
    if (beacon === '11i' || beacon === 'WPAand11i') {
      result.vendorPasswordValues = [
        [`${base}.Password(WPA)`, password, 'xsd:string'],
        [`${base}.Password(WPA2)`, password, 'xsd:string'],
      ];
    }
  }
  return result;
}

function isFiberhomeVendor(manufacturer) {
  const text = String(manufacturer || '').toLowerCase();
  return text.includes('fiberhome') || text.includes('fiber home');
}

module.exports = {
  parseWlanUpdate,
  planWlanUpdate,
  passwordPathFor,
};
