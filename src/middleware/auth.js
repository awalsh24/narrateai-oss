// Single-user local mode: no signup/login/session — every request is
// attributed to the one user configured via .env.
function requireAuth(req, res, next) {
  const { LOCAL_USER_ID, LOCAL_USER_EMAIL } = process.env
  if (!LOCAL_USER_ID || !LOCAL_USER_EMAIL) {
    return res.status(500).json({ error: 'LOCAL_USER_ID and LOCAL_USER_EMAIL must be set' })
  }
  req.user = { id: LOCAL_USER_ID, email: LOCAL_USER_EMAIL }
  next()
}

module.exports = { requireAuth }
