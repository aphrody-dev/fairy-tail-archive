export const sceneShader = /* wgsl */ `
struct Uniforms { mvp:mat4x4<f32>, params:vec4<f32> }
@group(0) @binding(0) var<uniform> u:Uniforms;
@group(0) @binding(1) var texSampler:sampler;
@group(0) @binding(2) var image:texture_2d<f32>;
@group(0) @binding(3) var mask:texture_2d<f32>;
struct VertexOut { @builtin(position) position:vec4<f32>, @location(0) uv:vec2<f32> }
@vertex fn vertexMain(@builtin(vertex_index) id:u32)->VertexOut {
  let points=array<vec2<f32>,6>(vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
  let point=points[id];var out:VertexOut;
  out.position=u.mvp*vec4(point,0.,1.);
  out.uv=vec2(point.x*.5+.5,.5-point.y*.5);
  return out;
}
@fragment fn fragmentMain(v:VertexOut)->@location(0) vec4<f32> {
  let pixel=textureSample(image,texSampler,v.uv);
  let m=textureSample(mask,texSampler,v.uv).a;
  let alpha=pixel.a*u.params.x*mix(1.,m,u.params.y);
  return vec4(pixel.rgb*u.params.z*alpha,alpha);
}`;

/** Compute-driven ambient motes. Colors are sampled from the current source texture. */
export const particleShader = /* wgsl */ `
struct Motion { time:f32,dt:f32,aspect:f32,strength:f32 }
@group(0) @binding(0) var<uniform> motion:Motion;
@group(0) @binding(1) var<storage,read_write> particles:array<vec4<f32>>;
fn hash(n:f32)->f32 {return fract(sin(n*127.1)*43758.547);}
@compute @workgroup_size(64) fn simulate(@builtin(global_invocation_id) gid:vec3<u32>) {
  let i=gid.x;if(i>=128u){return;}
  let id=f32(i);let seed=hash(id+1.);
  particles[i]=vec4(fract(seed+motion.time*(.008+hash(id+2.)*.012))*2.-1.,fract(hash(id+3.)+motion.time*(.014+seed*.018))*2.-1.,.004+hash(id+4.)*.009,seed);
}`;
export const particleRenderShader = /* wgsl */ `
struct Motion { time:f32,dt:f32,aspect:f32,strength:f32 }
@group(0) @binding(0) var<uniform> motion:Motion;
@group(0) @binding(1) var<storage,read> particles:array<vec4<f32>>;
@group(0) @binding(2) var texSampler:sampler;
@group(0) @binding(3) var image:texture_2d<f32>;
struct V { @builtin(position) pos:vec4<f32>,@location(0) uv:vec2<f32>,@location(1) colorUV:vec2<f32> }
@vertex fn vertexMain(@builtin(vertex_index) id:u32,@builtin(instance_index) instance:u32)->V {
  let points=array<vec2<f32>,6>(vec2(-1.,-1.),vec2(1.,-1.),vec2(-1.,1.),vec2(-1.,1.),vec2(1.,-1.),vec2(1.,1.));
  let p=particles[instance];let corner=points[id];var out:V;
  out.pos=vec4(p.xy+corner*p.z*vec2(1./motion.aspect,1.),0.,1.);
  out.uv=corner;out.colorUV=vec2(p.w,fract(p.w*3.7));return out;
}
@fragment fn fragmentMain(v:V)->@location(0) vec4<f32> {
  let light=pow(max(0.,1.-length(v.uv)),2.)*.35*motion.strength;
  let color=textureSample(image,texSampler,v.colorUV).rgb;
  return vec4(color*light,light);
}`;
