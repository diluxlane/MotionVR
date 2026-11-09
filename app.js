/* MotionVR — original zero-dependency browser VR prototype.
   No analytics, servers, camera access, or video uploads.
   License: MIT. Intended for testing, not a validated headset product. */
'use strict';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const video = $('sourceVideo');
const theater = $('theater');
const state = {
  gl: null, program: null, uniforms: {}, texture: null,
  sourceUrl: null, hasVideo: false, textureError: false,
  headset: false, tracking: false, sensorReceived: false,
  gotAbsolute: false, lastAbsoluteAt: 0, lastSensorAt: 0,
  lastTelemetryAt: 0, lastFrameAt: 0, alphaSamples: [],
  sensorQ: [0,0,0,1], baseQ: null, smoothQ: [0,0,0,1],
  touchYaw: 0, touchPitch: 0, touchEnabled: true,
  dragging: false, pointerX: 0, pointerY: 0, lastAlpha: null,
  lastAcceptedAlpha: null, lastAcceptedAt: 0, orientationSource: null,
  fov: 75, smoothing: 60, projection: 'cinema', layout: 'mono'
};

const vshader = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;
const fshader = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uVideo;
uniform vec4 uQuat;
uniform float uAspect;
uniform float uTanFov;
uniform float uVideoAspect;
uniform int uProjection;
uniform int uLayout;
uniform int uEye;
uniform bool uHasVideo;
const float PI = 3.141592653589793;

vec3 rotate(vec3 ray, vec4 q) {
  vec3 t = 2.0 * cross(q.xyz, ray);
  return ray + q.w * t + cross(q.xyz, t);
}
void main() {
  vec2 norm = 2.0 * vUv - 1.0;
  vec3 ray = normalize(vec3(norm.x * uAspect * uTanFov, norm.y * uTanFov, -1.0));
  vec3 direction = normalize(rotate(ray, uQuat));
  vec3 background = mix(vec3(0.008, 0.015, 0.024), vec3(0.035, 0.061, 0.075), clamp(0.55 + direction.y * 0.45, 0.0, 1.0));
  vec2 sampleUv;
  bool visible = true;
  if (uProjection == 0) {
    // Immovable virtual cinema screen; turn your head to look away.
    if (direction.z >= -0.001) {
      visible = false;
    } else {
      float halfWidth = 0.86;
      float halfHeight = halfWidth / max(0.3, uVideoAspect);
      vec2 onScreen = direction.xy / -direction.z;
      sampleUv = vec2(0.5 + onScreen.x / (2.0 * halfWidth), 0.5 + onScreen.y / (2.0 * halfHeight));
      visible = all(greaterThanEqual(sampleUv, vec2(0.0))) && all(lessThanEqual(sampleUv, vec2(1.0)));
      if (!visible) {
        float edge = max(abs(onScreen.x / halfWidth), abs(onScreen.y / halfHeight));
        background += vec3(0.011,0.025,0.023) * exp(-max(0.0,edge - 1.0) * 21.0);
      }
    }
  } else {
    float longitude = atan(direction.x, -direction.z);
    float latitude = asin(clamp(direction.y, -1.0, 1.0));
    if (uProjection == 2) {
      visible = abs(longitude) <= PI * 0.5;
      sampleUv = vec2(longitude / PI + 0.5, latitude / PI + 0.5);
    } else {
      sampleUv = vec2(longitude / (2.0 * PI) + 0.5, latitude / PI + 0.5);
    }
  }
  if (visible && uHasVideo) {
    if (uLayout == 1) {
      sampleUv.x = sampleUv.x * 0.5 + float(uEye) * 0.5;
    } else if (uLayout == 2) {
      sampleUv.y = sampleUv.y * 0.5 + (uEye == 0 ? 0.5 : 0.0);
    }
    gl_FragColor = texture2D(uVideo, sampleUv);
  } else {
    // Standby atmosphere. No unlicensed background assets or network calls.
    float lineX = abs(fract((direction.x + 1.0) * 19.0) - 0.5);
    float lineY = abs(fract((direction.y + 1.0) * 16.0) - 0.5);
    float grid = (1.0 - smoothstep(0.0, 0.026, min(lineX, lineY))) * 0.018;
    gl_FragColor = vec4(background + vec3(grid), 1.0);
  }
}`;

function notify(message, severity = '') {
  const element = $('message');
  element.textContent = message;
  element.className = 'message' + (severity ? ' ' + severity : '');
}

function compile(gl, type, source) {
  const s = gl.createShader(type);
  gl.shaderSource(s, source);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) || 'Shader compilation failed');
  }
  return s;
}
function initGl() {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' });
  if (!gl) throw new Error('WebGL is not available in this browser.');
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vshader));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fshader));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'WebGL program link failed');
  }
  gl.useProgram(program);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,-1, 1,1, -1,1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0,0,0,255]));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const u = {};
  for (const name of ['uVideo','uQuat','uAspect','uTanFov','uVideoAspect','uProjection','uLayout','uEye','uHasVideo']) u[name] = gl.getUniformLocation(program, name);
  gl.uniform1i(u.uVideo, 0);
  state.gl = gl;
  state.program = program;
  state.uniforms = u;
  state.texture = texture;
}

function qMultiply(a,b) {
  const [ax,ay,az,aw]=a, [bx,by,bz,bw]=b;
  return [ax*bw+aw*bx+ay*bz-az*by, ay*bw+aw*by+az*bx-ax*bz, az*bw+aw*bz+ax*by-ay*bx, aw*bw-ax*bx-ay*by-az*bz];
}
function qInverse(q) { return [-q[0],-q[1],-q[2],q[3]]; }
function qNormalize(q) { const n = Math.hypot(...q) || 1; return q.map(v=>v/n); }
function qSlerp(a, b, t) {
  let dot = a[0]*b[0]+a[1]*b[1]+a[2]*b[2]+a[3]*b[3];
  if (dot < 0) { dot = -dot; b = b.map(v=>-v); }
  if (dot > 0.9995) return qNormalize(a.map((v,i)=>v+(b[i]-v)*t));
  const theta = Math.acos(Math.max(-1, Math.min(1,dot)));
  const sin = Math.sin(theta);
  const w1 = Math.sin((1-t)*theta)/sin;
  const w2 = Math.sin(t*theta)/sin;
  return a.map((v,i)=>v*w1+b[i]*w2);
}
function qFromEuler(x,y,z) {
  // Euler YXZ, as in the established DeviceOrientationControls convention.
  const c1=Math.cos(x/2),c2=Math.cos(y/2),c3=Math.cos(z/2);
  const s1=Math.sin(x/2),s2=Math.sin(y/2),s3=Math.sin(z/2);
  return [s1*c2*c3+c1*s2*s3, c1*s2*c3-s1*c2*s3, c1*c2*s3-s1*s2*c3, c1*c2*c3+s1*s2*s3];
}
function sensorQuaternion(alpha,beta,gamma) {
  const rad=Math.PI/180;
  const screenAngle = screen.orientation?.angle || window.orientation || 0;
  const q = qFromEuler(beta*rad, alpha*rad, -gamma*rad);
  const fixed = qMultiply(q,[ -Math.SQRT1_2,0,0,Math.SQRT1_2 ]);
  return qNormalize(qMultiply(fixed,[0,0,-Math.sin(screenAngle*rad/2),Math.cos(screenAngle*rad/2)]));
}
function handleOrientation(event, absoluteEvent = false) {
  if (event.beta == null || event.gamma == null) return;
  const now = performance.now();
  if (absoluteEvent || event.absolute) { state.gotAbsolute = true; state.lastAbsoluteAt = now; }
  if (!absoluteEvent && !event.absolute && now-state.lastAbsoluteAt < 1200) return;
  const source = absoluteEvent || event.absolute ? 'absolute' : 'relative';
  const alpha = Number.isFinite(event.alpha) ? event.alpha : 0;
  // Some magnetometers intermittently return implausible heading jumps.
  // Ignore isolated spikes rather than letting the headset snap violently.
  if (Number.isFinite(event.alpha) && state.lastAcceptedAlpha != null) {
    const jump = Math.abs(((alpha - state.lastAcceptedAlpha + 540) % 360) - 180);
    if (jump > 75 && now - state.lastAcceptedAt < 130) return;
  }
  if (state.orientationSource && source !== state.orientationSource) {
    // Do not compare relative and absolute coordinate frames directly.
    state.baseQ = null;
  }
  state.orientationSource = source;
  if (Number.isFinite(event.alpha)) {
    state.lastAcceptedAlpha = alpha;
    state.lastAcceptedAt = now;
  }
  state.sensorQ = sensorQuaternion(alpha, event.beta, event.gamma);
  state.sensorReceived = true;
  state.lastSensorAt = now;
  if (!state.baseQ) state.baseQ = state.sensorQ.slice();
  // A real 10+ degree heading excursion is more meaningful than tiny alpha jitter.
  // Alpha changing is still only a hint, not proof of accurate 360-degree tracking.
  if (Number.isFinite(event.alpha)) state.alphaSamples.push({time:now, angle:alpha});
  state.lastAlpha = event.alpha;
  state.alphaSamples = state.alphaSamples.filter(sample=>now-sample.time<10000);
  const headings = state.alphaSamples.map(sample=>sample.angle * Math.PI / 180);
  const s = headings.reduce((t,a)=>t+Math.sin(a),0), c = headings.reduce((t,a)=>t+Math.cos(a),0);
  const center = Math.atan2(s,c)*180/Math.PI;
  const offsets = state.alphaSamples.map(sample=>((sample.angle-center+540)%360)-180);
  const headingRange = offsets.length ? Math.max(...offsets)-Math.min(...offsets) : 0;
  const headingChanged = headingRange>=12;
  if (now-state.lastTelemetryAt > 180) {
    $('alpha').textContent = event.alpha == null ? 'N/A' : `${alpha.toFixed(1)}°`;
    $('beta').textContent = `${event.beta.toFixed(1)}°`;
    $('gamma').textContent = `${event.gamma.toFixed(1)}°`;
    $('sensorStatus').textContent = state.gotAbsolute ? 'Orientation available (absolute)' : 'Orientation available';
    $('sensorDetail').textContent = !Number.isFinite(event.alpha) ? 'No heading supplied: tilt works, horizontal turns may not.' : (headingChanged ? 'Heading changed 12°+. Verify left/right direction with a 360° video.' : 'Heading not verified yet. Rotate left and right by 30°+.');
    $('sensorLight').className = 'sensor-light active';
    state.lastTelemetryAt = now;
  }
}

async function enableMotion() {
  if (!window.isSecureContext) {
    notify('Motion tracking usually requires HTTPS (or localhost). Deploy to an HTTPS host to test your sensors.', 'warn');
    return;
  }
  if (!('DeviceOrientationEvent' in window)) {
    notify('This browser does not expose DeviceOrientationEvent. Try recent Chrome on Android, or use touch control.', 'warn');
    return;
  }
  if (state.tracking) { notify('Motion listening is already enabled. Rotate your phone and inspect α, β, γ.'); return; }
  try {
    const cls = window.DeviceOrientationEvent;
    if (typeof cls.requestPermission === 'function') {
      let result;
      try { result = await cls.requestPermission(true); }
      catch { result = await cls.requestPermission(); }
      if (result !== 'granted') throw new Error('Motion permission was denied.');
    }
    state.tracking = true;
    window.addEventListener('deviceorientation', (e)=>handleOrientation(e,false));
    window.addEventListener('deviceorientationabsolute', (e)=>handleOrientation(e,true));
    $('sensorStatus').textContent = 'Waiting for orientation data…';
    $('sensorLight').className = 'sensor-light warn';
    $('enableMotion').textContent = 'Motion enabled ✓';
    notify('Sensor listeners enabled. Rotate your phone left/right and up/down, then check the α/β/γ readings.');
    setTimeout(()=>{
      if (!state.sensorReceived) {
        $('sensorStatus').textContent = 'No orientation readings received';
        $('sensorDetail').textContent = 'Check browser permissions or use touch controls.';
        notify('The browser did not provide sensor readings. This is a hardware/browser compatibility limitation.', 'warn');
      }
    },2500);
  } catch(error) { notify(error.message || 'Could not enable motion sensors.', 'error'); }
}
function recenter() {
  if (state.sensorReceived) state.baseQ = state.sensorQ.slice();
  state.touchYaw=0; state.touchPitch=0;
  state.smoothQ=[0,0,0,1];
  notify('View recentered. Keep the headset stable and turn your head gently to test tracking.');
}

function setSource(src, label, fromUrl=false) {
  if (state.sourceUrl) { URL.revokeObjectURL(state.sourceUrl); state.sourceUrl=null; }
  video.pause();
  state.hasVideo = false;
  state.textureError = false;
  $('empty').hidden = false;
  $('fileName').textContent = label;
  video.src = src;
  video.load();
  notify(fromUrl ? 'Loading remote video… The host must allow cross-origin video for WebGL rendering.' : 'Loading local video… It stays on this device.');
}
function loadLocal() {
  const file = $('localFile').files?.[0];
  if (!file) return;
  if (file.type && !file.type.startsWith('video/')) { notify('Please select a video file.', 'error'); return; }
  const url = URL.createObjectURL(file);
  setSource(url,file.name);
  state.sourceUrl=url;
}
function loadRemote() {
  try {
    const raw = $('videoUrl').value.trim();
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && !(parsed.protocol==='http:' && /^(localhost|127\.0\.0\.1)$/.test(parsed.hostname))) {
      throw new Error('Use a direct HTTPS video URL, not a webpage or an insecure HTTP address.');
    }
    setSource(parsed.href,parsed.hostname+parsed.pathname,true);
  } catch(err) { notify(err.message || 'Invalid URL.', 'error'); }
}
function fmtTime(seconds) {
  if (!Number.isFinite(seconds)) return '0:00';
  const n=Math.max(0,Math.floor(seconds)), m=Math.floor(n/60),s=String(n%60).padStart(2,'0');
  return `${m}:${s}`;
}
function refreshPlayback() {
  $('playPause').textContent = video.paused ? '▶' : '❚❚';
  $('timeNow').textContent=fmtTime(video.currentTime);
  $('timeTotal').textContent=fmtTime(video.duration);
  $('seek').value=Number.isFinite(video.duration) && video.duration>0 ? Math.round(video.currentTime/video.duration*1000):0;
  $('mute').textContent=video.muted?'✕◖':'◖))';
  $('liveLabel').innerHTML=video.paused?'<i></i> VIDEO PAUSED':'<i></i> NOW PLAYING';
}
async function playPause() {
  if (!state.hasVideo) { notify('Choose a video before pressing play.', 'warn'); return; }
  if (video.paused) { try { await video.play(); } catch(error) { notify(`Playback failed: ${error.message}`, 'error'); } }
  else video.pause();
  refreshPlayback();
}
async function setHeadset(on) {
  state.headset=on;
  theater.classList.toggle('vr-active',on);
  document.body.style.overflow=on?'hidden':'';
  if (on) {
    try { if (theater.requestFullscreen && document.fullscreenElement!==theater) await theater.requestFullscreen(); } catch {}
    try { if (screen.orientation?.lock) await screen.orientation.lock('landscape'); } catch {}
    notify('Headset mode on. Place the phone in landscape, adjust the lenses, and recenter while facing forward.');
  } else {
    if (document.fullscreenElement === theater) { try { await document.exitFullscreen(); } catch {} }
    try { screen.orientation?.unlock?.(); } catch {}
    notify('Exited headset mode.');
  }
  updateModeLabel();
  resizeCanvas();
}
function updateModeLabel() {
  $('modeLabel').textContent=`${state.projection.toUpperCase()} / ${state.layout.toUpperCase()}${state.headset?' / VR':''}`;
}
function resizeCanvas() {
  if (!state.gl) return;
  const dpr=Math.min(window.devicePixelRatio||1,1.5);
  const w=Math.max(1,Math.round(canvas.clientWidth*dpr));
  const h=Math.max(1,Math.round(canvas.clientHeight*dpr));
  if (canvas.width!==w||canvas.height!==h) {canvas.width=w;canvas.height=h;}
}
function draw(timestamp) {
  requestAnimationFrame(draw);
  if (!state.gl || document.hidden) return;
  // One draw per frame, with cheap smoothing. FPS depends on GPU + browser.
  resizeCanvas();
  const gl=state.gl, u=state.uniforms;
  if (state.hasVideo && video.readyState>=video.HAVE_CURRENT_DATA && !state.textureError) {
    try {
      gl.bindTexture(gl.TEXTURE_2D,state.texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,video);
    } catch(error) {
      state.textureError=true;
      notify('Cannot use this video as a WebGL texture. For remote links, the host must enable CORS; try a downloaded local file instead.', 'error');
    }
  }
  let sensorDelta=[0,0,0,1];
  if (state.sensorReceived && state.baseQ) {
    // Both quaternions map device space to world space. Recenter into the
    // initial device frame: q_relative = inverse(q_initial) * q_current.
    // The previous order gave rotations in world space and could distort
    // yaw on a tilted/landscape-mounted phone.
    sensorDelta=qMultiply(qInverse(state.baseQ),state.sensorQ);
  }
  const touchQ=qFromEuler(state.touchPitch,state.touchYaw,0);
  const target=qNormalize(qMultiply(sensorDelta,touchQ));
  const elapsed=state.lastFrameAt?Math.min(60,timestamp-state.lastFrameAt):16.67;
  state.lastFrameAt=timestamp;
  const responsiveness=0.58-(state.smoothing/100)*0.51;
  const factor=1-Math.pow(1-responsiveness,elapsed/16.67);
  // Suppress sub-degree sensor noise at rest without hiding real head turns.
  const separation=Math.abs(state.smoothQ[0]*target[0]+state.smoothQ[1]*target[1]+state.smoothQ[2]*target[2]+state.smoothQ[3]*target[3]);
  const angle=2*Math.acos(Math.min(1,Math.max(-1,separation)));
  if (angle>0.0035) state.smoothQ=qSlerp(state.smoothQ,target,factor);
  gl.useProgram(state.program);
  gl.uniform4fv(u.uQuat,new Float32Array(state.smoothQ));
  gl.uniform1f(u.uTanFov,Math.tan(state.fov*Math.PI/360));
  // When SBS or top/bottom is present, each eye's source half is its own image aspect.
  const baseAspect=video.videoWidth && video.videoHeight ? video.videoWidth/video.videoHeight : 16/9;
  const correctedAspect=state.layout==='sbs'?baseAspect*0.5:state.layout==='tb'?baseAspect*2:baseAspect;
  gl.uniform1f(u.uVideoAspect,correctedAspect);
  gl.uniform1i(u.uProjection,state.projection==='360'?1:state.projection==='180'?2:0);
  gl.uniform1i(u.uLayout,state.layout==='sbs'?1:state.layout==='tb'?2:0);
  gl.uniform1i(u.uHasVideo,state.hasVideo&&!state.textureError?1:0);
  const count=state.headset?2:1;
  for(let eye=0;eye<count;eye++) {
    const x=Math.round(canvas.width*eye/count),next=Math.round(canvas.width*(eye+1)/count);
    const width=next-x;
    gl.viewport(x,0,width,canvas.height);
    gl.uniform1f(u.uAspect,width/canvas.height);
    gl.uniform1i(u.uEye,state.layout==='mono'?0:eye);
    gl.drawArrays(gl.TRIANGLES,0,6);
  }
}

// All playback and sensor interaction stays inside this page.
$('enableMotion').addEventListener('click',enableMotion);
$('localFile').addEventListener('change',loadLocal);
$('loadUrl').addEventListener('click',loadRemote);
$('videoUrl').addEventListener('keydown',e=>{if(e.key==='Enter')loadRemote();});
$('playPause').addEventListener('click',playPause);
$('hudPlay').addEventListener('click',playPause);
$('mute').addEventListener('click',()=>{video.muted=!video.muted;refreshPlayback();});
$('seek').addEventListener('input',()=>{if(Number.isFinite(video.duration)&&video.duration>0)video.currentTime=Number($('seek').value)/1000*video.duration;});
$('recenter').addEventListener('click',recenter);
$('hudCenter').addEventListener('click',recenter);
$('touchToggle').addEventListener('click',()=>{state.touchEnabled=!state.touchEnabled;$('touchToggle').textContent=`Touch: ${state.touchEnabled?'ON':'OFF'}`;$('touchToggle').setAttribute('aria-pressed',String(state.touchEnabled));});
$('projection').addEventListener('change',(e)=>{state.projection=e.target.value;updateModeLabel();});
$('layout').addEventListener('change',(e)=>{state.layout=e.target.value;updateModeLabel();});
$('fov').addEventListener('input',(e)=>{state.fov=Number(e.target.value);$('fovValue').textContent=`${state.fov}°`;});
$('smooth').addEventListener('input',(e)=>{state.smoothing=Number(e.target.value);$('smoothValue').textContent=state.smoothing>75?'High':state.smoothing>35?'Medium':'Low';});
$('enterVr').addEventListener('click',()=>setHeadset(true));
$('hudExit').addEventListener('click',()=>setHeadset(false));
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement){await document.exitFullscreen();}else if(theater.requestFullscreen){await theater.requestFullscreen();}}catch{notify('Fullscreen is blocked by this browser.','warn');}});
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement && state.headset) {state.headset=false;theater.classList.remove('vr-active');document.body.style.overflow='';updateModeLabel();}});
canvas.addEventListener('pointerdown',(e)=>{if(!state.touchEnabled)return;state.dragging=true;state.pointerX=e.clientX;state.pointerY=e.clientY;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',(e)=>{if(!state.dragging || !state.touchEnabled) return;const dx=e.clientX-state.pointerX,dy=e.clientY-state.pointerY;state.pointerX=e.clientX;state.pointerY=e.clientY;state.touchYaw-=dx/Math.max(1,canvas.clientWidth)*Math.PI*1.45;state.touchPitch=Math.max(-1.45,Math.min(1.45,state.touchPitch-dy/Math.max(1,canvas.clientHeight)*Math.PI));});
canvas.addEventListener('pointerup',()=>{state.dragging=false;});
canvas.addEventListener('pointercancel',()=>{state.dragging=false;});
video.addEventListener('loadedmetadata',async()=>{
  state.hasVideo=true;
  $('empty').hidden=true;
  for(const id of ['playPause','mute','seek']) $(id).disabled=false;
  refreshPlayback();
  notify(`Video loaded (${video.videoWidth} × ${video.videoHeight}). Press Play. Select the correct source projection and stereo layout.`);
});
video.addEventListener('error',()=>{state.hasVideo=false;notify('Could not load this video. Check the file/URL, browser codec support, HTTPS, and CORS for remote sources.','error');});
video.addEventListener('timeupdate',refreshPlayback);
video.addEventListener('durationchange',refreshPlayback);
video.addEventListener('play',refreshPlayback);
video.addEventListener('pause',refreshPlayback);
video.addEventListener('ended',refreshPlayback);
window.addEventListener('resize',resizeCanvas);
window.addEventListener('beforeunload',()=>{if(state.sourceUrl)URL.revokeObjectURL(state.sourceUrl);});

try { initGl(); requestAnimationFrame(draw); }
catch(err) {
  // Safe degradation: native flat video rather than a blank screen.
  theater.classList.add('fallback');
  theater.insertBefore(video, canvas.nextSibling);
  $('enterVr').disabled = true;
  notify(`VR renderer unavailable: ${err.message} The player can still show normal video, but not VR.`, 'warn');
}