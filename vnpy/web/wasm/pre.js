// pre.js — VeighNa WASM Engine bridge
// Manages WebSocket connection from JS side, dispatches events to frontend

var WasmEngine = (function() {
  var ws = null;
  var wsUrl = 'ws://' + location.hostname + ':8888/ws';
  var reconnectTimer = null;
  var connected = false;

  // Event handlers — set by frontend
  var handlers = {
    tick: null, order: null, trade: null,
    position: null, account: null, log: null, status: null
  };

  function rawSend(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(msg);
    } else {
      console.warn('[WASM] WebSocket not connected, message queued');
    }
  }

  function connect() {
    if (ws) { try { ws.close(); } catch(e) {} }
    ws = new WebSocket(wsUrl);

    ws.onopen = function() {
      connected = true;
      if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
      console.log('[WASM] ✅ Connected to backend');
      rawSend('{"action":"get_status","payload":{}}');
      if (typeof window.onWasmConnected === 'function') window.onWasmConnected();
    };

    ws.onmessage = function(e) {
      try {
        var msg = JSON.parse(e.data);
        var type = msg.type || '';
        var data = msg.data || {};

        if (type.startsWith('eTick.'))       handlers.tick && handlers.tick(data);
        else if (type.startsWith('eOrder.')) handlers.order && handlers.order(data);
        else if (type.startsWith('eTrade.')) handlers.trade && handlers.trade(data);
        else if (type.startsWith('ePosition.')) handlers.position && handlers.position(data);
        else if (type.startsWith('eAccount.'))  handlers.account && handlers.account(data);
        else if (type === 'eLog')            handlers.log && handlers.log(data);
        else if (type === 'status')          handlers.status && handlers.status(data);
      } catch(err) { console.error('[WASM] Parse error:', err); }
    };

    ws.onclose = function() {
      connected = false;
      console.log('[WASM] Disconnected — reconnecting in 2s...');
      if (!reconnectTimer) reconnectTimer = setInterval(connect, 2000);
    };

    ws.onerror = function() { ws.close(); };
  }

  // Start connection
  connect();

  // Public API
  return {
    _rawSend: rawSend,
    on: function(event, fn) { handlers[event] = fn; },
    isConnected: function() { return connected; },
    reconnect: connect,

    // These get bound from C++ after WASM loads
    sendOrder: null,
    cancelOrder: null,
    subscribe: null,
    queryAccount: null,
    queryPosition: null,
    connectGateway: null,
    calcVWAP: null,
    calcSharpe: null,
    calcMaxDD: null
  };
})();
