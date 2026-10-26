const path = require('path');
const mysql = require('mysql2/promise');
const loadEnv = require('./backend/load_env');

loadEnv(path.join(__dirname, '.env'));

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'oriza',
  password: process.env.DB_PASSWORD || 'HasdinRadius23!',
  database: process.env.DB_NAME || 'acs_db',
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;
