"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/src/lib/utils";

export interface GrainGradientProps {
  colorLight?: string;
  colorMid?: string;
  colorDark?: string;
  angle?: number;
  position?: number;
  curve?: number;
  softness?: number;
  scale?: number;
  grain?: number;
  grainSize?: number;
  seed?: number;
  speed?: number;
  className?: string;
  style?: CSSProperties;
}

const VERTEX = `attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}`;
const FRAGMENT = `precision highp float;
uniform vec2 r; uniform float t,ratio,angle,position,curve,softness,scale,grain,grainSize,seed;
uniform vec3 light,mid,dark;
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){vec2 uv=gl_FragCoord.xy/r;uv.y=1.-uv.y;vec2 p=uv-.5;float a=r.x/r.y;p.x*=a;
float c=cos(angle),s=sin(angle);p=mat2(c,-s,s,c)*p;p.x/=a;p=p/scale+.5;
float b=sin(t*.52),u=sin(t*.31);float edge=.32+(curve+sin(t*.52-.7)*.12)*pow(1.-p.y,2.)+position+b*.115+u*.035;
float d=p.x-edge+sin(p.y*4.+t*.38)*.035;float soft=softness*(1.+b*.28);float sh=smoothstep(-soft,soft*.45,d);
vec2 lc=vec2(.04+b*.13,.04+u*.16);vec2 lu=(p-lc)*vec2(1.9,1.7);float m=exp(-dot(lu,lu));
vec3 l=mix(light,mid,m*(.66+b*.1));vec3 color=mix(l,mid*(.68+b*.035),smoothstep(-soft*1.8,.02,d));color=mix(color,dark,sh);
vec2 gp=floor(gl_FragCoord.xy/(ratio*grainSize));color+=(hash(gp+mod(seed,1000.)*13.7)-.5)*grain*mix(.48,.32,sh);gl_FragColor=vec4(clamp(color,0.,1.),1.);}`;

function rgb(value: string, fallback: string) {
  let hex = /^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value) ? value.slice(1) : fallback.slice(1);
  if (hex.length === 3) hex = hex.split("").map((part) => part + part).join("");
  return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
}

function clamp(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

/** Decorative WebGL background. Give the container an explicit height. */
export function GrainGradient({
  colorLight = "#f7f8f4",
  colorMid = "#d9e8df",
  colorDark = "#8fb7a6",
  angle = 0,
  position = 0,
  curve = 0.48,
  softness = 0.13,
  scale = 1,
  grain = 0.24,
  grainSize = 1,
  seed = 1,
  speed = 1,
  className,
  style,
}: GrainGradientProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const settings = useRef({ colorLight, colorMid, colorDark, angle, position, curve, softness, scale, grain, grainSize, seed, speed });

  useEffect(() => {
    settings.current = { colorLight, colorMid, colorDark, angle, position, curve, softness, scale, grain, grainSize, seed, speed };
  }, [colorLight, colorMid, colorDark, angle, position, curve, softness, scale, grain, grainSize, seed, speed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas?.getContext("webgl", { alpha: false, antialias: false, depth: false });
    if (!canvas || !gl) return;

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type);
      if (!shader) return null;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
    };
    const vertex = compile(gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!vertex || !fragment || !program || !buffer) return;
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    gl.useProgram(program); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const attribute = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, 2, gl.FLOAT, false, 0, 0);
    const uniform = (name: string) => gl.getUniformLocation(program, name);
    const locations = { r: uniform("r"), t: uniform("t"), ratio: uniform("ratio"), angle: uniform("angle"), position: uniform("position"), curve: uniform("curve"), softness: uniform("softness"), scale: uniform("scale"), grain: uniform("grain"), grainSize: uniform("grainSize"), seed: uniform("seed"), light: uniform("light"), mid: uniform("mid"), dark: uniform("dark") };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0; let previous = 0; let elapsed = 0; let ratio = 1;
    const resize = () => { ratio = Math.min(devicePixelRatio || 1, 1.5); canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio)); canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio)); gl.viewport(0, 0, canvas.width, canvas.height); };
    const draw = (now: number) => {
      const s = settings.current; if (previous && !reduced.matches) elapsed += Math.min((now - previous) / 1000, .05) * clamp(s.speed, 0, 2, 1); previous = now;
      gl.uniform2f(locations.r, canvas.width, canvas.height); gl.uniform1f(locations.ratio, ratio); gl.uniform1f(locations.t, elapsed); gl.uniform1f(locations.angle, (clamp(s.angle, -360, 360, 0) * Math.PI) / 180); gl.uniform1f(locations.position, clamp(s.position, -1, 1, 0)); gl.uniform1f(locations.curve, clamp(s.curve, -1, 1, .48)); gl.uniform1f(locations.softness, clamp(s.softness, .01, 1, .13)); gl.uniform1f(locations.scale, clamp(s.scale, .25, 3, 1)); gl.uniform1f(locations.grain, clamp(s.grain, 0, 1, .24)); gl.uniform1f(locations.grainSize, clamp(s.grainSize, .5, 4, 1)); gl.uniform1f(locations.seed, clamp(s.seed, 0, 100000, 1)); gl.uniform3fv(locations.light, rgb(s.colorLight, "#f7f8f4")); gl.uniform3fv(locations.mid, rgb(s.colorMid, "#d9e8df")); gl.uniform3fv(locations.dark, rgb(s.colorDark, "#8fb7a6")); gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced.matches && document.visibilityState === "visible") frame = requestAnimationFrame(draw);
    };
    const refresh = () => { cancelAnimationFrame(frame); previous = 0; resize(); frame = requestAnimationFrame(draw); };
    const observer = new ResizeObserver(refresh); observer.observe(canvas); document.addEventListener("visibilitychange", refresh); reduced.addEventListener("change", refresh); refresh();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); document.removeEventListener("visibilitychange", refresh); reduced.removeEventListener("change", refresh); gl.deleteBuffer(buffer); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); };
  }, []);

  return <div aria-hidden="true" className={cn("pointer-events-none relative h-full w-full overflow-hidden", className)} style={{ background: `linear-gradient(${120 + angle}deg, ${colorMid}, ${colorLight} 42%, ${colorDark})`, ...style }}><canvas ref={canvasRef} className="absolute inset-0 block size-full" /></div>;
}
