module.exports = {
  apps: [{
    name:               'a11y-tool',
    script:             'src/server.js',
    instances:          1,          // single instance — Playwright is stateful
    autorestart:        true,
    watch:              false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
