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
      max_restarts: 10,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || '3180',
        DATA_DIR: process.env.DATA_DIR || '/data',
        TZ: process.env.TZ || 'Asia/Shanghai'
      }
    }
  ]
}
