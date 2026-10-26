// Jawaban RADIUS per grup profil (radgroupreply), dipakai profil Hotspot dan
// profil Langganan (PPP).
//
//   - Mikrotik-Group := <nama grup>   selalu ditulis. MikroTik memakai nilainya
//     untuk memilih PPP Profile / Hotspot User Profile dengan nama yang SAMA
//     PERSIS di router. Aturan lain (queue type, address pool, dst.) tetap
//     dikelola pemilik MikroTik di profil itu.
//   - Mikrotik-Rate-Limit := <limit>  hanya ditulis bila admin mengisi limit di
//     web. Bila dikosongkan, baris ini dihapus sehingga MikroTik memakai limit
//     dari profilnya sendiri.
const GROUP_ATTRIBUTE = 'Mikrotik-Group';
const RATE_ATTRIBUTE = 'Mikrotik-Rate-Limit';
const MAX_GROUP_NAME = 64;

class GroupConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GroupConflictError';
    this.statusCode = 409;
  }
}

// Menulis satu atribut grup; nilai kosong berarti atribut dihapus.
async function writeGroupReply(executor, groupname, attribute, value) {
  if (!value) {
    await executor.execute(
      'DELETE FROM radgroupreply WHERE groupname = ? AND attribute = ?',
      [groupname, attribute],
    );
    return;
  }
  const [updated] = await executor.execute(
    "UPDATE radgroupreply SET op = ':=', value = ? WHERE groupname = ? AND attribute = ?",
    [String(value), groupname, attribute],
  );
  if (updated.affectedRows === 0) {
    await executor.execute(
      "INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ':=', ?)",
      [groupname, attribute, String(value)],
    );
  }
}

async function writeProfileReply(executor, groupname, rateLimit) {
  await writeGroupReply(executor, groupname, GROUP_ATTRIBUTE, groupname);
  await writeGroupReply(executor, groupname, RATE_ATTRIBUTE, rateLimit || '');
}

// Grup tidak dipakai profil mana pun lagi: cabut atribut yang dikelola aplikasi.
async function releaseGroupReply(executor, groupname) {
  if (!groupname) {
    return;
  }
  const [langganan] = await executor.execute(
    'SELECT id FROM langganan_profiles WHERE BINARY group_name = ? LIMIT 1',
    [groupname],
  );
  const [hotspot] = await executor.execute(
    'SELECT id FROM hotspot_profiles WHERE BINARY mikrotik_group = ? LIMIT 1',
    [groupname],
  );
  if (langganan.length > 0 || hotspot.length > 0) {
    return;
  }
  await executor.execute(
    'DELETE FROM radgroupreply WHERE groupname = ? AND attribute IN (?, ?)',
    [groupname, GROUP_ATTRIBUTE, RATE_ATTRIBUTE],
  );
}

// Satu nama grup hanya boleh dipakai profil yang limit-nya sama, karena jawaban
// RADIUS dibuat per grup. Profil Hotspot dan Langganan tidak boleh berbagi grup.
async function assertGroupAvailable(executor, groupname, rateLimit, ownLanggananId = 0) {
  const [hotspot] = await executor.execute(
    'SELECT id FROM hotspot_profiles WHERE BINARY mikrotik_group = ? LIMIT 1',
    [groupname],
  );
  if (hotspot.length > 0) {
    throw new GroupConflictError('Group sudah dipakai profil Hotspot');
  }
  const [other] = await executor.execute(
    `SELECT id FROM langganan_profiles
     WHERE BINARY group_name = ? AND id <> ? AND COALESCE(rate_limit, '') <> ? LIMIT 1`,
    [groupname, ownLanggananId, rateLimit || ''],
  );
  if (other.length > 0) {
    throw new GroupConflictError('Group sudah dipakai profil lain dengan rate limit berbeda');
  }
}

// Menulis ulang jawaban grup semua profil yang sudah ada (sekali jalan untuk data lama).
async function syncAllProfileReplies(executor) {
  const [langganan] = await executor.query(
    "SELECT group_name, rate_limit FROM langganan_profiles WHERE group_name IS NOT NULL AND group_name <> ''",
  );
  const [hotspot] = await executor.query(
    "SELECT mikrotik_group, rate_limit FROM hotspot_profiles WHERE mikrotik_group <> ''",
  );
  for (const row of langganan) {
    await writeProfileReply(executor, row.group_name, row.rate_limit);
  }
  for (const row of hotspot) {
    await writeProfileReply(executor, row.mikrotik_group, row.rate_limit);
  }
  return { langganan: langganan.length, hotspot: hotspot.length };
}

module.exports = {
  GROUP_ATTRIBUTE,
  RATE_ATTRIBUTE,
  MAX_GROUP_NAME,
  GroupConflictError,
  writeGroupReply,
  writeProfileReply,
  releaseGroupReply,
  assertGroupAvailable,
  syncAllProfileReplies,
};
