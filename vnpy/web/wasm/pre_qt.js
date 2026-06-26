// pre_qt.js — SDL2 canvas setup for VeighNa Qt-WASM
Module['preRun'] = [];
Module['postRun'] = [];
Module['canvas'] = (function() {
  var canvas = document.getElementById('canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'canvas';
    canvas.style.cssText = 'display:block;width:100%;height:100%;background:#1e1e1e';
    document.body.style.cssText = 'margin:0;padding:0;overflow:hidden;background:#1e1e1e';
    document.body.appendChild(canvas);
  }
  return canvas;
})();
