const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: 'localhost',
  user: 'oriza',
  password: 'HasdinRadius23!',
  database: 'acs_db',
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
