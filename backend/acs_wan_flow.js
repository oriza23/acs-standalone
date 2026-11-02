// Alur provisioning WAN PPP / IP dengan arsitektur Queue-and-Fire (lihat acs.js).
//
//   Fase 1  AddObject (hanya bila membuat koneksi baru) -> nomor instance.
//   Fase 2  Parameter inti = 1 task SetParameterValues, parameter berisiko (ConnectionType, ServiceList,
//           Name) = task terpisah; semuanya hanya diantrekan. ZTE: satu RPC atomik (lihat mode atomik).
//   Fase 3  Satu Connection Request di paling akhir.
//
// Modul ini tidak tahu HTTP Express: ia melempar WanFlowError (validasi/guard, ada status HTTP) atau NbiError
// (ONU/ACS), dan route yang menerjemahkannya ke respons.
const acs = require('./acs');
const {
  planWanPpp, planWanIp, connectionTypeError, connectionPathOf, vendorProfile, batchWanParameters,
  splitWanParameters, connectionLeavesFor, readOnlyLeavesFor, ctcomWanIndexGuard, cmccGuard,
  zteVlanFallbackPayloads, isStructuralRejection, prefersAtomicWan, isCommitLoopFault, omitBridgeAuth,
  atomicIncludesName, compareWanReadback,
} = require('./acs_wan');

class WanFlowError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'WanFlowError';
    this.status = status;
  }
}

function stripAuth(rows) {
  return rows.filter(([path]) => {
    const leaf = String(path).split('.').pop();
    return leaf !== 'Username' && leaf !== 'Password';
  });
}

// Rollback instance baru bila Fase 2 gagal. Timeout rollback tidak dianggap error (task sudah dibuang).
async function rollbackNewWan(server, deviceId, rollbackPath, label) {
  try {
    await acs.sendWanDeleteObject(server, deviceId, rollbackPath, { rollback: true });
    console.log(`[ACS ${label}] rollback ${deviceId} ${rollbackPath}`);
    return { removed: true, note: '' };
  } catch (rollbackError) {
    const timedOut = rollbackError?.code === 'TIMEOUT' || rollbackError?.code === 'PENDING';
    if (timedOut) {
      console.warn(`[ACS ${label}] rollback ${deviceId} ${rollbackPath} diabaikan karena timeout`);
      return { removed: false, note: '' };
    }
    console.warn(`[ACS ${label}] rollback ${deviceId} ${rollbackPath}: ${rollbackError.message}`);
    return { removed: false, note: ` Instance baru gagal dihapus (${rollbackError.message}).` };
  }
}

// Model yang terbukti menolak (CWMP 9003) pemecahan ConnectionType/ServiceList dari Enable. Diingat selama
// proses berjalan supaya provisioning berikutnya langsung memakai mode atomik tanpa percobaan gagal.
const atomicModels = new Set();

function atomicKeyOf(manufacturer, productModel) {
  return `${manufacturer || ''}|${productModel || ''}`.toLowerCase();
}

// Satu percobaan Queue-and-Fire: pecah baris menjadi inti + berisiko, tambahkan Connection Name sebagai
// task berisiko terakhir. Mode atomik: semuanya satu RPC (Name sebelum Enable).
function fireAttempt(server, deviceId, rows, nameRows, atomic, profile) {
  if (atomic) {
    // Semua parameter satu SetParameterValues, Enable paling akhir. Fiberhome: Name tetap task terpisah.
    const inlineName = atomicIncludesName(profile);
    const { core } = splitWanParameters(inlineName ? [...rows, ...nameRows] : rows, { atomic: true });
    return acs.queueAndFireWanBatch(server, deviceId, {
      core,
      risky: inlineName ? [] : nameRows.map((row) => [row]),
    });
  }
  const { core, risky } = splitWanParameters(rows);
  return acs.queueAndFireWanBatch(server, deviceId, {
    core,
    risky: [...risky, ...nameRows.map((row) => [row])],
  });
}

// Penolakan generik (9003 "Invalid arguments") pada inti: bukan path salah/read-only/commit loop.
function isCoreRejection(error) {
  return error?.code === 'FAULT' && !isStructuralRejection(error);
}

// Bisakah mode atomik mengubah sesuatu? Hanya bila ada parameter berisiko yang tadinya dipisah.
function atomicChangesPayload(rows, nameRows) {
  return nameRows.length > 0 || splitWanParameters(rows).risky.length > 0;
}

// Urutan percobaan per struktur VLAN:
//   1. mode terpisah (default; atomik untuk ZTE / model yang sudah dipelajari),
//   2. bila inti ditolak ONU secara generik -> ulang SEKALI dalam mode atomik (struktur sama),
//   3. baru struktur VLAN alternatif (ZTE -> GPON -> EPON), kecuali ONU sudah jelas memakai struktur native
//      ZTE (leaf X_ZTE-COM_* ada di pohon): GPON/EPON pasti salah dan hanya menghasilkan WAN palsu.
// Task yang gagal sudah dibuang dari antrean oleh queueAndFireWanBatch sebelum percobaan berikutnya.
async function pushWithFallback(server, deviceId, plan, payload, label, prepare, { atomicKey, nativeStructure } = {}) {
  const nameRows = Array.isArray(plan?.connectionName) ? plan.connectionName : [];
  const fallbacks = nativeStructure ? [] : zteVlanFallbackPayloads(plan);
  const attempts = [
    { kind: plan?.vlanKind || 'awal', rows: payload },
    ...fallbacks.map((item) => ({ kind: item.kind, rows: prepare(item.parameterValues) })),
  ];
  let atomic = prefersAtomicWan(plan?.profile) || (atomicKey ? atomicModels.has(atomicKey) : false);
  let lastError = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    if (index > 0) {
      console.log(`[ACS ${label}] path VLAN ditolak (${lastError.message}). Mencoba struktur ${attempt.kind}.`);
    }
    for (;;) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const result = await fireAttempt(server, deviceId, attempt.rows, nameRows, atomic, plan?.profile);
        return { ...result, atomic };
      } catch (error) {
        lastError = error;
        if (!atomic && isCoreRejection(error) && atomicChangesPayload(attempt.rows, nameRows)) {
          atomic = true;
          if (atomicKey) {
            atomicModels.add(atomicKey);
          }
          console.log(`[ACS ${label}] inti ditolak (${error.message}); mengulang atomik (semua parameter + Name dalam satu RPC).`);
          continue;
        }
        break;
      }
    }
    const retry = index < attempts.length - 1
      && !plan?.singleAttempt
      && !plan?.vlanBlocked
      && !isStructuralRejection(lastError);
    if (!retry) {
      throw lastError;
    }
  }
  throw lastError;
}

// Catatan untuk respons: hasil task berisiko + penjelasan Connection Name.
function summarizeRisky(risky, plan) {
  const notes = [];
  const rejected = risky?.rejected || [];
  if (rejected.length > 0) {
    notes.push(`${rejected.map((item) => item.name).join(', ')} ditolak ONU (${rejected.map((item) => item.reason).join('; ')}); parameter lain tetap diterapkan`);
  }
  if ((risky?.pending || []).length > 0) {
    notes.push(`${risky.pending.join(', ')} masih diproses ONU di latar belakang`);
  }
  if (!Array.isArray(plan?.connectionName) || plan.connectionName.length === 0) {
    notes.push('Nama koneksi dibuat otomatis oleh ONU');
  }
  return { partial: rejected.length > 0, notes };
}

const VERIFY_BUDGET_MS = 9000;
const VERIFY_READ_ATTEMPTS = 5;
const VERIFY_READ_GAP_MS = 800;

// Fase 4 (Fiberhome): "task hilang dari antrean GenieACS" hanya berarti ONU membalas RPC. Untuk memastikan WAN
// benar-benar ada, ONU diminta melaporkan ulang instance itu (refreshObject = GetParameterValues ke ONU),
// lalu nilainya dibandingkan dengan yang dikirim.
// Catatan terukur: refreshObject ke path yang TIDAK ada pada ONU tetap dilaporkan berhasil (tanpa fault), jadi
// "ada/tidak" ditentukan dari isi pohon: Enable dan ConnectionType yang kita tulis harus terbaca kembali.
//   state 'absent'   = setelah refresh tidak ada leaf instance   -> caller melempar error + rollback
//   state 'mismatch' = instance ada, sebagian nilai berbeda       -> sukses parsial dengan rincian
//   state 'ok'       = semua nilai yang dikirim terbaca sama
//   state 'unknown'  = ONU tak menjawab dalam batas waktu         -> sukses dengan catatan belum terverifikasi
async function verifyOnOnu(server, deviceId, wanPath, connectionPath, payload) {
  let refresh;
  try {
    refresh = await acs.refreshDeviceObjects(server, deviceId, [String(wanPath).replace(/\.+$/, '')], { budgetMs: VERIFY_BUDGET_MS });
  } catch (error) {
    return { state: 'unknown', reason: error.message };
  }
  if (refresh.refreshed.length === 0) {
    return { state: 'unknown', reason: refresh.failed[0]?.reason || 'ONU belum menjawab pembacaan ulang' };
  }
  // Data hasil refresh ditulis GenieACS di akhir sesi: baca beberapa kali sebelum menyimpulkan instance hilang.
  let comparison = null;
  for (let attempt = 0; attempt < VERIFY_READ_ATTEMPTS; attempt += 1) {
    if (attempt > 0) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, VERIFY_READ_GAP_MS); });
    }
    // eslint-disable-next-line no-await-in-loop
    const doc = await acs.readWanSubtree(server, deviceId, connectionPath).catch(() => null);
    if (!doc) {
      return { state: 'unknown', reason: 'hasil pembacaan ulang tidak bisa diambil dari GenieACS' };
    }
    comparison = compareWanReadback(doc, payload);
    if (!(comparison.missing.includes('Enable') && comparison.missing.includes('ConnectionType'))) {
      return { state: comparison.mismatched.length > 0 ? 'mismatch' : 'ok', ...comparison };
    }
  }
  return { state: 'absent', reason: 'Enable dan ConnectionType tidak terbaca dari ONU setelah pembacaan ulang.' };
}

function verificationNotes(verification) {
  if (verification.state === 'ok') {
    return { partial: false, verified: true, notes: ['Terverifikasi: ONU melaporkan nilai yang sama'] };
  }
  if (verification.state === 'mismatch') {
    const detail = verification.mismatched.map((item) => `${item.name}=${JSON.stringify(item.actual)} (dikirim ${JSON.stringify(item.expected)})`).join(', ');
    return { partial: true, verified: false, notes: [`ONU melaporkan nilai berbeda: ${detail}`] };
  }
  if (verification.state === 'unknown') {
    return { partial: false, verified: false, notes: [`Belum terverifikasi dari ONU (${verification.reason})`] };
  }
  return { partial: false, verified: false, notes: [] };
}

function readTargetLeaves(target, fresh, connectionPath) {
  const freshLeaves = connectionLeavesFor(fresh, connectionPath);
  const freshReadOnly = readOnlyLeavesFor(fresh, connectionPath);
  return {
    knownLeaves: freshLeaves.length ? freshLeaves : connectionLeavesFor(target, connectionPath),
    readOnlyLeaves: freshReadOnly.length ? freshReadOnly : readOnlyLeavesFor(target, connectionPath),
    deviceLeaves: fresh?.deviceLeaves?.length ? fresh.deviceLeaves : target.deviceLeaves,
    wanIndexValues: fresh?.wanIndexValues?.length ? fresh.wanIndexValues : target.wanIndexValues,
  };
}

function guardTarget(target, values, manufacturer, modelName) {
  const cmcc = cmccGuard({
    knownLeaves: target.knownLeaves,
    deviceLeaves: target.deviceLeaves,
    readOnlyLeaves: target.readOnlyLeaves,
    manufacturer,
    productModel: target.productModel,
    productClass: target.productClass,
    ...(modelName ? { modelName } : {}),
  });
  if (cmcc.blocked) {
    throw new WanFlowError(409, cmcc.message);
  }
  const ctcom = ctcomWanIndexGuard({
    knownLeaves: target.knownLeaves,
    readOnlyLeaves: target.readOnlyLeaves,
    wanIndexValues: target.wanIndexValues,
    vlanRequested: values.vlanStatus === true,
  });
  if (ctcom.blocked) {
    throw new WanFlowError(409, ctcom.message);
  }
}

const WAN_KINDS = {
  ppp: {
    label: 'wan-ppp',
    title: 'WAN PPP',
    pathKey: 'pppPath',
    filterRows: (rows, values) => omitBridgeAuth(rows, values.connectionType),
    precheck(target, values, manufacturer) {
      const typeError = connectionTypeError(manufacturer, values.connectionType, values.deviceType);
      if (typeError) {
        throw new WanFlowError(400, typeError);
      }
      if (!target.tr181 && !target.wanDeviceIndex) {
        throw new WanFlowError(400, 'Struktur WAN tidak ditemukan pada perangkat. Jalankan Summon lalu coba lagi.');
      }
    },
    modelName: () => '',
    createInstance: (server, values, target, manufacturer) => acs.createWanPppInstance(server, values.deviceId, {
      profile: target.tr181 ? 'tr181' : vendorProfile(manufacturer),
      tr181: target.tr181,
      wanDeviceIndex: target.wanDeviceIndex,
      connectionIndex: target.connectionIndex,
      createConnectionDevice: target.createConnectionDevice,
      reusedEmpty: target.reusedEmpty,
    }),
    buildPlan: ({ target, ...args }) => planWanPpp({ ...args, dataModel: target.tr181 ? 'Device' : target.model }),
  },
  ip: {
    label: 'wan-ip',
    title: 'WAN IP',
    pathKey: 'ipPath',
    filterRows: (rows) => stripAuth(rows),
    precheck(target) {
      if (target.tr181) {
        throw new WanFlowError(400, 'Model TR-181 belum mendukung pembuatan WAN IP dari form ini.');
      }
      if (!target.wanDeviceIndex) {
        throw new WanFlowError(400, 'Struktur WAN tidak ditemukan pada perangkat. Jalankan Summon lalu coba lagi.');
      }
    },
    modelName: (target, values) => target.productModel || values.modelName,
    createInstance: (server, values, target, manufacturer) => acs.createWanIpInstance(server, values.deviceId, {
      profile: vendorProfile(manufacturer),
      tr181: false,
      wanDeviceIndex: target.wanDeviceIndex,
      connectionIndex: target.connectionIndex,
      createConnectionDevice: target.createConnectionDevice,
      reusedEmpty: target.reusedEmpty,
    }),
    buildPlan: ({ target, ...args }) => planWanIp({ ...args, dataModel: target.model }),
  },
};

// Hasil sukses: { wanPath, applied, partial, message, summary }.
// Gagal: melempar WanFlowError / NbiError / Error biasa. Pada error non-guard, properti `wanPath` diisi bila
// instance baru gagal di-rollback (supaya UI tahu ada sisa) dan `rollbackNote` berisi catatan rollback.
// expectProfile (opsional, mis. 'zte'): menolak perangkat yang mereknya di ACS bukan profil itu SEBELUM
// ada AddObject, supaya endpoint khusus merek tidak membuat WAN di ONU yang salah.
async function runWan(cfg, { server, values, username, expectProfile }) {
  const timer = acs.wanTimer();
  const deviceId = values.deviceId;
  let wanPath = values.wanPath;
  let rollbackPath = null;

  try {
    // Pembacaan pohon (DB ACS) dan pembersihan task basi berjalan bersamaan: tidak menambah latensi.
    const [target] = await Promise.all([
      acs.readWanTarget(server, deviceId),
      acs.purgeStaleWanTasks(server, deviceId),
    ]);
    if (!target) {
      throw new WanFlowError(404, 'Perangkat tidak ditemukan di GenieACS');
    }
    const manufacturer = target.manufacturer || values.manufacturer;
    if (expectProfile && vendorProfile(manufacturer) !== expectProfile) {
      throw new WanFlowError(409, `Perangkat ini bukan ${expectProfile.toUpperCase()} (merek terbaca di ACS: ${manufacturer || 'tidak diketahui'}). Gunakan endpoint WAN yang sesuai merek.`);
    }
    const modelName = cfg.modelName(target, values);
    cfg.precheck(target, values, manufacturer);
    console.log(`[ACS ${cfg.label}] pohon ${deviceId}: model=${modelName || target.model} WANDevice=${target.wanDeviceIndex || '-'} WANConnectionDevice=${target.connectionIndex || 'baru'}`);
    guardTarget(target, values, manufacturer, modelName);
    timer.mark('baca');

    // Fase 1: satu-satunya round-trip wajib (nomor slot).
    if (!wanPath) {
      const created = await cfg.createInstance(server, values, target, manufacturer);
      wanPath = created[cfg.pathKey];
      rollbackPath = created.rollbackPath || wanPath;
    }
    timer.mark('instance');

    // Pohon dibaca ulang (query DB ACS, tanpa menyentuh ONU) agar VLAN/MTU hanya memakai parameter yang ada.
    const fresh = await acs.readWanTarget(server, deviceId);
    const connectionPath = connectionPathOf(wanPath);
    const leaves = readTargetLeaves(target, fresh, connectionPath);
    const plan = cfg.buildPlan({
      values,
      target,
      manufacturer,
      modelName,
      productModel: fresh?.productModel || target.productModel,
      productClass: fresh?.productClass || target.productClass,
      accessType: fresh?.accessType || target.accessType,
      [cfg.pathKey]: wanPath,
      connectionPath,
      ...leaves,
    });
    if (plan.vlanBlocked) {
      throw new acs.NbiError(plan.blockedMessage, undefined, 'READONLY');
    }

    // Fase 2 + 3.
    const prepare = (rows) => cfg.filterRows(rows, values);
    const payload = prepare(batchWanParameters(plan));
    const nativeStructure = plan.vlanKind === 'zte'
      && (leaves.knownLeaves || []).some((name) => /X_ZTE-COM_/i.test(name));
    const atomicKey = atomicKeyOf(manufacturer, fresh?.productModel || target.productModel || modelName);
    const result = await pushWithFallback(server, deviceId, plan, payload, cfg.label, prepare, { atomicKey, nativeStructure });
    timer.mark('set');

    // Fase 4: ONU harus benar-benar memiliki WAN-nya sebelum frontend menerima 200.
    let verification = { state: 'skipped' };
    if (plan.profile === 'fiberhome') {
      verification = await verifyOnOnu(server, deviceId, wanPath, connectionPath, payload);
      timer.mark('verifikasi');
      if (verification.state === 'absent') {
        throw new acs.NbiError(
          `ONU membalas perintah tetapi ${wanPath} tidak ada pada ONU, WAN tidak terbentuk. ${verification.reason}`,
          undefined,
          'FAULT',
        );
      }
    }
    const checked = verificationNotes(verification);

    const summary = summarizeRisky(result.risky, plan);
    const partial = summary.partial || checked.partial;
    const notes = [...summary.notes, ...checked.notes];
    console.log(`[ACS ${cfg.label}] ${username || '-'} ${server.host}:${server.port} ${deviceId} ${plan.profile} ${wanPath} ${plan.fields.join(', ')} (diterapkan, ${result.atomic ? 'atomik' : 'terpisah'}) waktu[${timer.summary()}]`);
    return {
      wanPath,
      applied: true,
      partial,
      verified: checked.verified,
      message: [`Koneksi ${cfg.title} diterapkan ke ONU`, ...notes].join('. '),
    };
  } catch (error) {
    if (error instanceof WanFlowError) {
      throw error;
    }
    console.error(`[ACS ${cfg.label}] ${deviceId} ${wanPath || '-'}: ${error.message}`);
    // Commit loop: antrean sudah dibersihkan, rollback hanya akan menambah sesi yang gagal.
    if (isCommitLoopFault(error)) {
      throw error;
    }
    error.rollbackNote = '';
    if (rollbackPath && !values.wanPath) {
      const rollback = await rollbackNewWan(server, deviceId, rollbackPath, cfg.label);
      error.rollbackNote = rollback.note;
      if (!rollback.removed) {
        error.wanPath = wanPath;
      }
    }
    throw error;
  }
}

const addWanPpp = (context) => runWan(WAN_KINDS.ppp, context);
const addWanIp = (context) => runWan(WAN_KINDS.ip, context);

module.exports = {
  WanFlowError,
  addWanPpp,
  addWanIp,
  verifyOnOnu,
  rollbackNewWan,
};
