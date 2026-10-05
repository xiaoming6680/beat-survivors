'use strict';
// WebGL2 渲染器：实例化 SDF 图元 → HDR 场景缓冲 → 多级 Bloom → 合成（涟漪、色差、暗角、颗粒、闪光）。

const SH = { CIRCLE: 0, RING: 1, TRI: 2, RHOMB: 3, BOX: 4, HEX: 5, SEG: 6, STAR: 7, ARC: 8, CROSS: 9, DIAMOND: 10 };

const R = (() => {
  let gl = null, canvas = null;
  let W = 1, H = 1;
  let scale = 1;
  let hdrFmt = null;
  const FL = 16; // 每个实例的 float 数
  const MAX = 50000;
  const data = new Float32Array(MAX * FL);
  let count = 0;
  let progSprite, progBg, progDown, progUp, progComp, progPre;
  let vaoSprite, vaoFull, instBuf;
  let scene = null;
  let mips = [];
  let quality = 'high';
  let alphaMul = 1; // 玩家特效强度（设置项 × 自动曝光）
  let tracking = false; // 统计玩家特效的叠加亮度
  let load = 0;
  const cam = { x: 0, y: 0, viewH: 1000, zoom: 1, halfW: 1, halfH: 1, shake: 0, sx: 0, sy: 0 };
  const post = {
    bloom: 0.5, ca: 0, flash: 0, flashColor: [1, 1, 1], vig: 0.35, grain: 0.035, hurt: 0, exposure: 1,
    ripples: [], // {x,y,t0,amp,speed,life}
    kick: 0, beat: 0, time: 0, tint: [0.3, 0.2, 1], tint2: [1, 0.2, 0.6], gridGlow: 1, sat: 1, desat: 0,
    // 曲风画面性格
    pixel: 0, scan: 0, grade: [1, 1, 1], styleDesat: 0, caBoost: 0, grainBoost: 0, vigBoost: 0,
  };

  // ---------------- 着色器 ----------------
  const VS_SPRITE = `#version 300 es
  layout(location=0) in vec2 a_corner;
  layout(location=1) in vec4 a0;
  layout(location=2) in vec4 a1;
  layout(location=3) in vec4 a2;
  layout(location=4) in vec4 a3;
  uniform vec2 u_cam;
  uniform vec2 u_half;
  out vec2 v_local;
  flat out vec4 v1;
  flat out vec4 v2;
  flat out vec4 v3;
  void main(){
    vec2 local = a_corner * a0.zw;
    float c = cos(a1.x), s = sin(a1.x);
    vec2 w = a0.xy + vec2(local.x*c - local.y*s, local.x*s + local.y*c);
    vec2 p = (w - u_cam) / u_half;
    gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
    v_local = local; v1 = a1; v2 = a2; v3 = a3;
  }`;

  const FS_SPRITE = `#version 300 es
  precision highp float;
  in vec2 v_local;
  flat in vec4 v1;
  flat in vec4 v2;
  flat in vec4 v3;
  uniform float u_px;
  out vec4 o;
  float ndot(vec2 a, vec2 b){ return a.x*b.x - a.y*b.y; }
  float sdBox(vec2 p, vec2 b){ vec2 d = abs(p)-b; return length(max(d,0.0)) + min(max(d.x,d.y),0.0); }
  float sdRhombus(vec2 p, vec2 b){
    p = abs(p);
    float h = clamp(ndot(b-2.0*p,b)/dot(b,b), -1.0, 1.0);
    float d = length(p-0.5*b*vec2(1.0-h,1.0+h));
    return d * sign(p.x*b.y + p.y*b.x - b.x*b.y);
  }
  float sdTri(vec2 p, float r){
    // 等边三角形，尖朝 +x
    p = vec2(p.y, -p.x);
    const float k = sqrt(3.0);
    p.x = abs(p.x) - r;
    p.y = p.y + r/k;
    if(p.x + k*p.y > 0.0) p = vec2(p.x - k*p.y, -k*p.x - p.y)/2.0;
    p.x -= clamp(p.x, -2.0*r, 0.0);
    return -length(p)*sign(p.y);
  }
  float sdHex(vec2 p, float r){
    const vec3 k = vec3(-0.866025404,0.5,0.577350269);
    p = abs(p);
    p -= 2.0*min(dot(k.xy,p),0.0)*k.xy;
    p -= vec2(clamp(p.x, -k.z*r, k.z*r), r);
    return length(p)*sign(p.y);
  }
  float sdStar5(vec2 p, float r, float rf){
    const vec2 k1 = vec2(0.809016994375, -0.587785252292);
    const vec2 k2 = vec2(-k1.x,k1.y);
    p.x = abs(p.x);
    p -= 2.0*max(dot(k1,p),0.0)*k1;
    p -= 2.0*max(dot(k2,p),0.0)*k2;
    p.x = abs(p.x);
    p.y -= r;
    vec2 ba = rf*vec2(-k1.y,k1.x) - vec2(0,1);
    float h = clamp(dot(p,ba)/dot(ba,ba), 0.0, r);
    return length(p-ba*h) * sign(p.y*ba.x-p.x*ba.y);
  }
  void main(){
    int sh = int(v1.y + 0.5);
    vec2 p = v_local;
    float p0 = v1.z, p1 = v1.w;
    float d;
    if(sh == 0) d = length(p) - p0;
    else if(sh == 1) d = abs(length(p) - p0) - p1;
    else if(sh == 2) d = sdTri(p, p0);
    else if(sh == 3) d = sdRhombus(p, vec2(p0, p1));
    else if(sh == 4) d = sdBox(p, vec2(p0, p1));
    else if(sh == 5) d = sdHex(p, p0);
    else if(sh == 6) { vec2 q = vec2(max(abs(p.x)-p0, 0.0), p.y); d = length(q) - p1; }
    else if(sh == 7) d = sdStar5(p.yx * vec2(1.0,-1.0), p0, 0.45);
    else if(sh == 8) {
      float gap = v3.x;
      float ang = abs(atan(p.y, p.x));
      d = abs(length(p) - p0) - p1;
      if(ang < gap){
        vec2 e = p0 * vec2(cos(gap), sin(gap));
        vec2 q = vec2(p.x, abs(p.y));
        d = length(q - e) - p1;
      }
    }
    else if(sh == 9) { vec2 q = abs(p); d = min(sdBox(q, vec2(p0, p1)), sdBox(q, vec2(p1, p0))); }
    else { d = sdRhombus(p, vec2(p0, p1)); }
    float aa = u_px;
    float fill = (sh == 8) ? 1.0 : v3.x;
    float rim = v3.y, gw = max(v3.z, 0.001), ga = v3.w;
    float inside = 1.0 - smoothstep(-aa, aa, d);
    float rimI = rim > 0.0 ? 1.0 - smoothstep(rim - aa, rim + aa, abs(d)) : 0.0;
    float dd = max(d, 0.0);
    float glow = ga * exp(-dd / gw) * (1.0 - inside);
    float I = inside * fill + rimI + glow;
    o = vec4(v2.rgb * I * v2.a, 1.0);
  }`;

  const VS_FULL = `#version 300 es
  layout(location=0) in vec2 a_pos;
  out vec2 v_uv;
  void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

  // 背景：无限霓虹网格 + 视差尘埃 + 玩家周围的地面光
  const FS_BG = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  uniform vec2 u_cam, u_half;
  uniform float u_time, u_kick, u_beat, u_px, u_glow;
  uniform vec3 u_tint, u_tint2;
  uniform vec2 u_player;
  out vec4 o;
  float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
  float gridLine(vec2 w, float cell, float width){
    vec2 g = abs(fract(w/cell - 0.5) - 0.5) * cell;
    float d = min(g.x, g.y);
    return 1.0 - smoothstep(0.0, width, d);
  }
  void main(){
    vec2 c = v_uv*2.0 - 1.0;
    vec2 w = u_cam + vec2(c.x, -c.y) * u_half;
    float pw = u_px * 1.2 + 0.6;
    float minor = gridLine(w, 100.0, pw);
    float major = gridLine(w, 400.0, pw*1.6);
    float dist = length(w - u_player);
    float spot = exp(-dist/900.0);
    float pulse = 0.55 + 0.9*u_kick;
    // 底鼓时从玩家处扩散的亮环
    float ringR = u_beat * 1400.0;
    float ring = exp(-pow((dist - ringR)/120.0, 2.0)) * (1.0 - u_beat) * 0.9;
    vec3 col = vec3(0.0);
    vec3 lc = mix(u_tint, u_tint2, 0.5 + 0.5*sin(w.x*0.0007 + w.y*0.0005 + u_time*0.1));
    col += lc * minor * 0.07 * (0.5 + spot) * pulse * u_glow;
    col += lc * major * 0.20 * (0.4 + spot) * pulse * u_glow;
    col += lc * (minor*0.5 + major) * ring * 0.35 * u_glow;
    // 地面光
    col += u_tint * 0.025 * spot * (1.0 + u_kick);
    // 视差尘埃
    for(int L=0; L<2; L++){
      float par = L==0 ? 0.55 : 0.3;
      vec2 sw = (w - u_cam*(1.0-par)) / (L==0 ? 140.0 : 90.0);
      vec2 id = floor(sw);
      vec2 f = fract(sw) - 0.5;
      float h = hash(id + float(L)*17.0);
      if(h > 0.82){
        vec2 off = vec2(hash(id+3.1), hash(id+7.7)) - 0.5;
        float dd = length(f - off*0.6);
        float tw = 0.5 + 0.5*sin(u_time*(1.0+h*3.0) + h*40.0);
        col += mix(u_tint2, vec3(1.0), 0.4) * smoothstep(0.06, 0.0, dd) * 0.18 * tw * (L==0?1.0:0.6);
      }
    }
    // 远处暗角式的深色底
    col += vec3(0.004, 0.003, 0.012);
    o = vec4(col, 1.0);
  }`;

  // Bloom 预滤（亮部提取 + 降采样）
  const FS_PRE = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  uniform sampler2D u_tex;
  uniform vec2 u_texel;
  uniform float u_thresh;
  out vec4 o;
  vec3 tap(vec2 uv){ return texture(u_tex, uv).rgb; }
  void main(){
    vec2 t = u_texel;
    vec3 a = tap(v_uv + t*vec2(-1,-1)), b = tap(v_uv + t*vec2(1,-1)), c = tap(v_uv + t*vec2(-1,1)), d = tap(v_uv + t*vec2(1,1));
    vec3 m = tap(v_uv);
    vec3 col = (a+b+c+d)*0.125 + m*0.5;
    float br = max(col.r, max(col.g, col.b));
    float k = smoothstep(u_thresh*0.5, u_thresh*1.5, br);
    o = vec4(col * k, 1.0);
  }`;

  // CoD 式 13 点降采样
  const FS_DOWN = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  uniform sampler2D u_tex;
  uniform vec2 u_texel;
  out vec4 o;
  vec3 s(vec2 o2){ return texture(u_tex, v_uv + o2*u_texel).rgb; }
  void main(){
    vec3 a = s(vec2(-2,-2)), b = s(vec2(0,-2)), c = s(vec2(2,-2));
    vec3 d = s(vec2(-2,0)), e = s(vec2(0,0)), f = s(vec2(2,0));
    vec3 g = s(vec2(-2,2)), h = s(vec2(0,2)), i = s(vec2(2,2));
    vec3 j = s(vec2(-1,-1)), k = s(vec2(1,-1)), l = s(vec2(-1,1)), m = s(vec2(1,1));
    vec3 col = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
    o = vec4(col, 1.0);
  }`;

  // 9 点帐篷升采样（叠加到上一级）
  const FS_UP = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  uniform sampler2D u_tex;
  uniform vec2 u_texel;
  uniform float u_w;
  out vec4 o;
  vec3 s(vec2 o2){ return texture(u_tex, v_uv + o2*u_texel).rgb; }
  void main(){
    vec3 col = s(vec2(0,0))*4.0 + (s(vec2(-1,0))+s(vec2(1,0))+s(vec2(0,-1))+s(vec2(0,1)))*2.0
      + s(vec2(-1,-1))+s(vec2(1,-1))+s(vec2(-1,1))+s(vec2(1,1));
    o = vec4(col/16.0 * u_w, 1.0);
  }`;

  const FS_COMP = `#version 300 es
  precision highp float;
  in vec2 v_uv;
  uniform sampler2D u_scene, u_bloom;
  uniform float u_bloomStr, u_ca, u_flash, u_vig, u_grain, u_time, u_hurt, u_aspect, u_exposure, u_desat;
  uniform float u_pixel, u_scan;
  uniform vec2 u_res;
  uniform vec3 u_flashColor, u_grade;
  uniform vec4 u_rip[8];
  uniform int u_nrip;
  out vec4 o;
  float hash(vec2 p){ p = fract(p*vec2(443.897, 441.423)); p += dot(p, p+19.19); return fract(p.x*p.y); }
  vec3 aces(vec3 x){ return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0.0, 1.0); }
  void main(){
    vec2 uv = v_uv;
    // 像素化（Chiptune）
    if(u_pixel > 0.0){ vec2 px = u_pixel / u_res; uv = (floor(uv / px) + 0.5) * px; }
    // 冲击波涟漪
    for(int i=0;i<8;i++){
      if(i >= u_nrip) break;
      vec4 r = u_rip[i];
      vec2 d = (uv - r.xy) * vec2(u_aspect, 1.0);
      float len = length(d);
      float wv = exp(-pow((len - r.z)/0.035, 2.0)) * r.w;
      uv -= (d/(len+1e-4)) / vec2(u_aspect,1.0) * wv * 0.018;
    }
    vec2 cc = uv - 0.5;
    float ca = u_ca * (0.4 + dot(cc,cc)*2.0);
    vec3 col;
    col.r = texture(u_scene, uv + cc*ca).r;
    col.g = texture(u_scene, uv).g;
    col.b = texture(u_scene, uv - cc*ca).b;
    vec3 bl;
    bl.r = texture(u_bloom, uv + cc*ca*1.5).r;
    bl.g = texture(u_bloom, uv).g;
    bl.b = texture(u_bloom, uv - cc*ca*1.5).b;
    col += bl * u_bloomStr;
    col *= u_exposure;
    col = aces(col);
    col *= u_grade;
    float l = dot(col, vec3(0.299,0.587,0.114));
    col = mix(col, vec3(l), u_desat);
    // 扫描线
    if(u_scan > 0.0){ col *= 1.0 - u_scan * (0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159 / max(1.0, u_pixel * 0.5 + 1.0))); }
    // 受击红色描边
    float edge = smoothstep(0.25, 0.75, length(cc*vec2(u_aspect*0.7,1.0)));
    col = mix(col, vec3(1.0,0.1,0.2), u_hurt * edge * 0.6);
    // 暗角
    col *= 1.0 - u_vig * smoothstep(0.35, 0.95, length(cc*vec2(1.0, 0.85))*1.25);
    // 颗粒
    col += (hash(gl_FragCoord.xy + fract(u_time)*100.0) - 0.5) * u_grain;
    // 白闪
    col = mix(col, u_flashColor, clamp(u_flash, 0.0, 1.0));
    col = pow(max(col, 0.0), vec3(1.0/2.2));
    o = vec4(col, 1.0);
  }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      throw new Error('着色器编译失败：' + log);
    }
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('着色器链接失败：' + gl.getProgramInfoLog(p));
    p.u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const name = info.name.replace(/\[0\]$/, '');
      p.u[name] = gl.getUniformLocation(p, info.name);
    }
    return p;
  }

  function makeTarget(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, hdrFmt.internal, w, h, 0, gl.RGBA, hdrFmt.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }
  function freeTarget(t) {
    if (!t) return;
    gl.deleteTexture(t.tex);
    gl.deleteFramebuffer(t.fbo);
  }

  function init(c) {
    canvas = c;
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    if (!gl) return false;
    const ext = gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('EXT_color_buffer_half_float');
    hdrFmt = ext ? { internal: gl.RGBA16F, type: gl.HALF_FLOAT } : { internal: gl.RGBA8, type: gl.UNSIGNED_BYTE };
    progSprite = program(VS_SPRITE, FS_SPRITE);
    progBg = program(VS_FULL, FS_BG);
    progPre = program(VS_FULL, FS_PRE);
    progDown = program(VS_FULL, FS_DOWN);
    progUp = program(VS_FULL, FS_UP);
    progComp = program(VS_FULL, FS_COMP);

    // 精灵 VAO
    vaoSprite = gl.createVertexArray();
    gl.bindVertexArray(vaoSprite);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, FL * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    gl.bindVertexArray(null);

    // 全屏三角
    vaoFull = gl.createVertexArray();
    gl.bindVertexArray(vaoFull);
    const fb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, fb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
    resize();
    return true;
  }

  function setQuality(q) {
    quality = q;
    resize();
  }

  function resize() {
    if (!gl) return;
    const dpr = window.devicePixelRatio || 1;
    scale = quality === 'low' ? Math.min(dpr, 1) * 0.75 : Math.min(dpr, 1.5);
    const cw = window.innerWidth, ch = window.innerHeight;
    W = Math.max(1, Math.round(cw * scale));
    H = Math.max(1, Math.round(ch * scale));
    canvas.width = W;
    canvas.height = H;
    canvas.style.width = cw + 'px';
    canvas.style.height = ch + 'px';
    freeTarget(scene);
    mips.forEach(freeTarget);
    scene = makeTarget(W, H);
    mips = [];
    let w = W >> 1, h = H >> 1;
    const levels = quality === 'low' ? 4 : 6;
    for (let i = 0; i < levels && w >= 4 && h >= 4; i++) {
      mips.push(makeTarget(w, h));
      w >>= 1;
      h >>= 1;
    }
  }

  // ---------------- 画图元 ----------------
  // shape: SH.*；p0/p1 形状参数；col = [r,g,b] 线性 HDR；a 透明度乘子
  // fill 内部填充亮度，rim 描边半宽（世界单位），gw 辉光衰减距离，ga 辉光强度
  function sprite(x, y, ext, rot, shape, p0, p1, col, a, fill, rim, gw, ga, extY) {
    if (count >= MAX) return;
    if (tracking) {
      // 估算这个图元在画面上的“亮度 × 面积”
      const area = shape === 1 || shape === 8 ? TAU * p0 * 2 * (p1 + gw * ga) : 4 * ext * (extY !== undefined ? extY : ext) * 0.6;
      load += a * fill * (col[0] + col[1] + col[2]) * area + a * (col[0] + col[1] + col[2]) * rim * 6 * ext;
    }
    const i = count++ * FL;
    const hx = ext + gw * 4;
    data[i] = x; data[i + 1] = y; data[i + 2] = hx; data[i + 3] = (extY !== undefined ? extY + gw * 4 : hx);
    data[i + 4] = rot; data[i + 5] = shape; data[i + 6] = p0; data[i + 7] = p1;
    data[i + 8] = col[0]; data[i + 9] = col[1]; data[i + 10] = col[2]; data[i + 11] = a * alphaMul;
    data[i + 12] = fill; data[i + 13] = rim; data[i + 14] = gw; data[i + 15] = ga;
  }
  // 便捷：发光圆点
  function dot(x, y, r, col, a = 1, glow = 1) {
    sprite(x, y, r, 0, SH.CIRCLE, r, 0, col, a, 1, 0, r * 0.9 + 2, 0.7 * glow);
  }
  function ring(x, y, r, th, col, a = 1, glow = 1) {
    sprite(x, y, r + th, 0, SH.RING, r, th, col, a, 1, 0, th * 1.5 + 3, 0.6 * glow);
  }
  function arc(x, y, r, th, gapCenter, gapHalf, col, a = 1) {
    // ARC：fill 槽位装缺口半角
    sprite(x, y, r + th, gapCenter, SH.ARC, r, th, col, a, gapHalf, 0, th * 1.5 + 3, 0.6);
  }
  // 线段（胶囊），从 (x1,y1) 到 (x2,y2)
  function line(x1, y1, x2, y2, w, col, a = 1, glow = 1) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) / 2;
    const ang = Math.atan2(dy, dx);
    if (count >= MAX) return;
    const gw = w * 1.2 + 3;
    if (tracking) load += a * (col[0] + col[1] + col[2]) * 2 * len * (2 * w + gw * glow);
    const i = count++ * FL;
    data[i] = (x1 + x2) / 2; data[i + 1] = (y1 + y2) / 2; data[i + 2] = len + w + gw * 4; data[i + 3] = w + gw * 4;
    data[i + 4] = ang; data[i + 5] = SH.SEG; data[i + 6] = len; data[i + 7] = w;
    data[i + 8] = col[0]; data[i + 9] = col[1]; data[i + 10] = col[2]; data[i + 11] = a * alphaMul;
    data[i + 12] = 1; data[i + 13] = 0; data[i + 14] = gw; data[i + 15] = 0.6 * glow;
  }
  // 多边形描边（霓虹风格：暗填充 + 亮边）
  function shape(x, y, size, rot, sh, col, a = 1, fill = 0.25, rim = 2, p1 = 0) {
    sprite(x, y, size * 1.2, rot, sh, size, p1 || size * 0.6, col, a, fill, rim, 3 + size * 0.15, 0.55);
  }

  function setCamera(x, y, zoom) {
    cam.x = x;
    cam.y = y;
    cam.zoom = zoom;
  }

  function view() {
    const aspect = W / H;
    const halfH = (cam.viewH / 2) / cam.zoom;
    return { halfW: halfH * aspect, halfH };
  }
  function worldToScreen(x, y) {
    const v = view();
    const sx = (x - cam.x - cam.sx) / v.halfW;
    const sy = (y - cam.y - cam.sy) / v.halfH;
    return { x: (sx * 0.5 + 0.5) * window.innerWidth, y: (sy * 0.5 + 0.5) * window.innerHeight };
  }

  function addRipple(x, y, amp = 1, speed = 1.2) {
    post.ripples.push({ x, y, t: 0, amp, speed });
    if (post.ripples.length > 8) post.ripples.shift();
  }

  // ---------------- 一帧 ----------------
  function render(dt, playerX, playerY) {
    if (!gl) return;
    const v = view();
    cam.halfW = v.halfW;
    cam.halfH = v.halfH;
    const cx = cam.x + cam.sx, cy = cam.y + cam.sy;
    const px = (v.halfH * 2) / H;

    // 背景
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.useProgram(progBg);
    gl.bindVertexArray(vaoFull);
    const u = progBg.u;
    gl.uniform2f(u.u_cam, cx, cy);
    gl.uniform2f(u.u_half, v.halfW, v.halfH);
    gl.uniform1f(u.u_time, post.time);
    gl.uniform1f(u.u_kick, post.kick);
    gl.uniform1f(u.u_beat, post.beat);
    gl.uniform1f(u.u_px, px);
    gl.uniform1f(u.u_glow, post.gridGlow);
    gl.uniform3fv(u.u_tint, post.tint);
    gl.uniform3fv(u.u_tint2, post.tint2);
    gl.uniform2f(u.u_player, playerX, playerY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 精灵（加法混合）
    if (count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(progSprite);
      gl.uniform2f(progSprite.u.u_cam, cx, cy);
      gl.uniform2f(progSprite.u.u_half, v.halfW, v.halfH);
      gl.uniform1f(progSprite.u.u_px, px);
      gl.bindVertexArray(vaoSprite);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, count * FL);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      gl.disable(gl.BLEND);
    }
    count = 0;

    // Bloom
    gl.bindVertexArray(vaoFull);
    if (mips.length) {
      gl.useProgram(progPre);
      gl.bindFramebuffer(gl.FRAMEBUFFER, mips[0].fbo);
      gl.viewport(0, 0, mips[0].w, mips[0].h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.tex);
      gl.uniform1i(progPre.u.u_tex, 0);
      gl.uniform2f(progPre.u.u_texel, 1 / W, 1 / H);
      gl.uniform1f(progPre.u.u_thresh, 0.6);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.useProgram(progDown);
      for (let i = 1; i < mips.length; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, mips[i].fbo);
        gl.viewport(0, 0, mips[i].w, mips[i].h);
        gl.bindTexture(gl.TEXTURE_2D, mips[i - 1].tex);
        gl.uniform1i(progDown.u.u_tex, 0);
        gl.uniform2f(progDown.u.u_texel, 1 / mips[i - 1].w, 1 / mips[i - 1].h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.useProgram(progUp);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = mips.length - 1; i > 0; i--) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, mips[i - 1].fbo);
        gl.viewport(0, 0, mips[i - 1].w, mips[i - 1].h);
        gl.bindTexture(gl.TEXTURE_2D, mips[i].tex);
        gl.uniform1i(progUp.u.u_tex, 0);
        gl.uniform2f(progUp.u.u_texel, 1 / mips[i].w, 1 / mips[i].h);
        gl.uniform1f(progUp.u.u_w, 0.75);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }

    // 合成
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progComp);
    const c = progComp.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(c.u_scene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, mips.length ? mips[0].tex : scene.tex);
    gl.uniform1i(c.u_bloom, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(c.u_bloomStr, mips.length ? post.bloom : 0);
    gl.uniform1f(c.u_ca, post.ca + post.caBoost);
    gl.uniform1f(c.u_flash, post.flash);
    gl.uniform3fv(c.u_flashColor, post.flashColor);
    gl.uniform1f(c.u_vig, post.vig + post.vigBoost);
    gl.uniform1f(c.u_grain, post.grain + post.grainBoost);
    gl.uniform1f(c.u_time, post.time);
    gl.uniform1f(c.u_hurt, post.hurt);
    gl.uniform1f(c.u_aspect, W / H);
    gl.uniform1f(c.u_exposure, post.exposure);
    gl.uniform1f(c.u_desat, Math.min(1, post.desat + post.styleDesat));
    gl.uniform1f(c.u_pixel, post.pixel * scale);
    gl.uniform1f(c.u_scan, post.scan);
    gl.uniform2f(c.u_res, W, H);
    gl.uniform3fv(c.u_grade, post.grade);
    // 涟漪：世界坐标 → uv
    const rip = new Float32Array(32);
    let n = 0;
    for (let i = post.ripples.length - 1; i >= 0; i--) {
      const r = post.ripples[i];
      r.t += dt;
      const rad = r.t * r.speed * 0.55;
      const amp = r.amp * Math.max(0, 1 - r.t / 0.9);
      if (amp <= 0.001) { post.ripples.splice(i, 1); continue; }
      if (n >= 8) continue;
      const ux = ((r.x - cx) / v.halfW) * 0.5 + 0.5;
      const uy = 1 - (((r.y - cy) / v.halfH) * 0.5 + 0.5);
      rip[n * 4] = ux; rip[n * 4 + 1] = uy; rip[n * 4 + 2] = rad; rip[n * 4 + 3] = amp;
      n++;
    }
    gl.uniform4fv(c.u_rip, rip);
    gl.uniform1i(c.u_nrip, n);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  return {
    init, resize, setQuality, setAlpha: (m) => { alphaMul = m; }, track: (on) => { tracking = on; if (on) load = 0; }, get load() { return load; }, sprite, dot, ring, arc, line, shape, setCamera, render, addRipple, view, worldToScreen,
    cam, post, get count() { return count; }, get ok() { return !!gl; },
  };
})();
