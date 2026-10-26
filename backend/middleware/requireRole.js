// Dipasang setelah requireAuth. Role yang tidak ada di daftar ditolak dengan 403.
function requireRole(...roles) {
  const allowed = new Set(roles);

  return function requireRoleMiddleware(req, res, next) {
    const role = typeof req.user?.role === 'string' ? req.user.role : '';
    if (!allowed.has(role)) {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak',
      });
    }
    return next();
  };
}

module.exports = requireRole;
