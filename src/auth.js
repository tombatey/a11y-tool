const passport       = require('passport');
const { Strategy }   = require('passport-google-oauth20');
const pool           = require('./db');

passport.use(new Strategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  `${process.env.APP_URL}/auth/google/callback`,
    scope:        ['profile', 'email'],
  },
  async (_accessToken, _refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      if (!email) return done(null, false, { message: 'No email returned from Google.' });

      const res = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      if (!res.rows[0]) {
        return done(null, false, { message: `${email} is not authorised to access this tool.` });
      }

      // Update display name and last login timestamp
      await pool.query(
        'UPDATE users SET name = $1, last_login = NOW() WHERE email = $2',
        [profile.displayName, email]
      );

      return done(null, { id: res.rows[0].id, email, name: profile.displayName });
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => done(null, user.email));

passport.deserializeUser(async (email, done) => {
  try {
    const res = await pool.query('SELECT id, email, name FROM users WHERE email = $1', [email]);
    done(null, res.rows[0] || false);
  } catch (err) {
    done(err);
  }
});

// Middleware — protects all routes that require a logged-in user
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  res.redirect('/login');
}

module.exports = { passport, requireAuth };
