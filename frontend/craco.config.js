// Only override needed: turn off webpack-dev-server's WebSocket (hot/live-reload
// client) — react-scripts hardcodes it on with no env-var switch to disable it.
// Everything else stays on CRA's default config.
module.exports = {
  devServer: (devServerConfig) => {
    devServerConfig.webSocketServer = false;
    devServerConfig.client = false;
    return devServerConfig;
  },
};
