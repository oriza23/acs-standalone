const pool = require('../database');

async function ensureTable() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS mikrotik_monitor (
      id TINYINT PRIMARY KEY,
      host VARCHAR(253) NOT NULL,
      port INT NOT NULL,
      username VARCHAR(64) NOT NULL,
      password VARCHAR(128) NOT NULL,
      interface_name VARCHAR(64) NOT NULL DEFAULT 'ether1',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
  );
}

async function saveCredentials(target) {
  await ensureTable();
  await pool.execute(
    `INSERT INTO mikrotik_monitor (id, host, port, username, password, interface_name)
     VALUES (1, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       host = VALUES(host),
       port = VALUES(port),
       username = VALUES(username),
       password = VALUES(password),
       interface_name = VALUES(interface_name)`,
    [target.host, target.port, target.user, target.password, target.iface],
  );
}

async function loadCredentials() {
  await ensureTable();
  const [rows] = await pool.execute(
    'SELECT host, port, username, password, interface_name FROM mikrotik_monitor WHERE id = 1 LIMIT 1',
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    routerId: null,
    routerName: row.host,
    host: row.host,
    user: row.username,
    password: row.password,
    port: Number(row.port),
    iface: row.interface_name || 'ether1',
  };
}

function publicSession(target) {
  if (!target) {
    return { saved: false };
  }
  return {
    saved: true,
    host: target.host,
    port: target.port,
    username: target.user,
    interface: target.iface,
  };
}

module.exports = {
  ensureTable,
  saveCredentials,
  loadCredentials,
  publicSession,
};
