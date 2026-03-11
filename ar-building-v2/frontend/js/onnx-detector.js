// onnx-detector.js – ONNX Runtime Web, Inferenz im Browser.
// Kein import/export – schreibt auf window.AR.onnx.

(function () {
  'use strict';

  var session         = null;
  var loadedModelPath = null;
  var INPUT_W         = 640;
  var INPUT_H         = 640;
  var CONF_THRESHOLD  = 0.45;

  async function loadModel(modelPath) {
    if (!modelPath || modelPath === loadedModelPath) return;
    if (session) { try { await session.release(); } catch (e) {} session = null; }
    try {
      session = await ort.InferenceSession.create(modelPath, { executionProviders: ['wasm'] });
      loadedModelPath = modelPath;
      console.log('[ONNX] Modell geladen:', modelPath);
    } catch (e) {
      console.error('[ONNX] Laden fehlgeschlagen:', e);
      session = null;
    }
  }

  function isModelLoaded() { return session !== null; }

  async function unloadModel() {
    if (session) { try { await session.release(); } catch (e) {} session = null; loadedModelPath = null; }
  }

  async function detect(videoEl) {
    if (!session || videoEl.readyState < videoEl.HAVE_ENOUGH_DATA) return [];
    var tensor = preprocessFrame(videoEl);
    if (!tensor) return [];
    try {
      var feeds  = {};
      feeds[session.inputNames[0]] = tensor;
      var output = await session.run(feeds);
      return parseOutput(output, videoEl.videoWidth, videoEl.videoHeight);
    } catch (e) {
      console.error('[ONNX] Inferenz-Fehler:', e);
      return [];
    }
  }

  function preprocessFrame(videoEl) {
    var canvas = document.createElement('canvas');
    canvas.width = INPUT_W; canvas.height = INPUT_H;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, INPUT_W, INPUT_H);
    var imgData = ctx.getImageData(0, 0, INPUT_W, INPUT_H).data;
    var f32 = new Float32Array(3 * INPUT_W * INPUT_H);
    for (var i = 0; i < INPUT_W * INPUT_H; i++) {
      f32[i]                         = imgData[i * 4]     / 255;
      f32[i + INPUT_W * INPUT_H]     = imgData[i * 4 + 1] / 255;
      f32[i + 2 * INPUT_W * INPUT_H] = imgData[i * 4 + 2] / 255;
    }
    return new ort.Tensor('float32', f32, [1, 3, INPUT_H, INPUT_W]);
  }

  function parseOutput(output, origW, origH) {
    var detections = [];
    var raw  = output[Object.keys(output)[0]];
    var data = raw.data;
    var dims = raw.dims;
    if (dims.length < 3) return detections;

    var numBoxes   = dims[2];
    var numClasses = dims[1] - 4;
    var scaleX = origW / INPUT_W;
    var scaleY = origH / INPUT_H;

    for (var b = 0; b < numBoxes; b++) {
      var cx = data[0 * numBoxes + b];
      var cy = data[1 * numBoxes + b];
      var bw = data[2 * numBoxes + b];
      var bh = data[3 * numBoxes + b];
      var bestClass = -1, bestConf = 0;
      for (var c = 0; c < numClasses; c++) {
        var conf = data[(4 + c) * numBoxes + b];
        if (conf > bestConf) { bestConf = conf; bestClass = c; }
      }
      if (bestConf < CONF_THRESHOLD || bestClass < 0) continue;
      detections.push({
        classId: bestClass, confidence: bestConf,
        box: { x: (cx - bw / 2) * scaleX, y: (cy - bh / 2) * scaleY, w: bw * scaleX, h: bh * scaleY },
      });
    }
    return detections;
  }

  window.AR = window.AR || {};
  window.AR.onnx = { loadModel: loadModel, isModelLoaded: isModelLoaded, unloadModel: unloadModel, detect: detect };
})();