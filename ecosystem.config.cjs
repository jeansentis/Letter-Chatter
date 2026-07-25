module.exports = {
  apps: [{
    name: "letter-chatters",
    script: "dist/src/server.js",
    cwd: __dirname,
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    watch: false,
    time: true,
    merge_logs: true,
    max_memory_restart: "1G",
    kill_timeout: 10000,
    env: {
      NODE_ENV: "production",
      PORT: 1010,
    },
  }],
};
