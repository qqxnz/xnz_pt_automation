module.exports = {
  apps: [
    {
      name: 'xnz-pt-automation',
      script: 'backend/dist/server.js',
      cwd: '/app',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      min_uptime: '10s',
      max_restarts: 5,
      restart_delay: 5000,
      kill_timeout: 10000,
      listen_timeout: 15000,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || '3180',
        DATA_DIR: process.env.DATA_DIR || '/data',
        TZ: process.env.TZ || 'Asia/Shanghai',
        XNZ_VERSION: process.env.XNZ_VERSION || 'dev',
        XNZ_SCHEMA_VERSION: process.env.XNZ_SCHEMA_VERSION || '21'
      }
    }
  ]
}
