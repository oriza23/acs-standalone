const jwt = require('jsonwebtoken');
const { secret } = require('../config/jwt');

// Memeriksa header "Authorization: Bearer <token>". Tidak ada / tidak valid -> 401.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({
      success: false,
      message: 'Token tidak ditemukan, silakan login',
    });
  }

  try {
    req.user = jwt.verify(token, secret, { algorithms: ['HS256'] });
    return next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.name === 'TokenExpiredError'
        ? 'Sesi login berakhir, silakan login kembali'
        : 'Token tidak valid',
    });
  }
}

module.exports = requireAuth;
