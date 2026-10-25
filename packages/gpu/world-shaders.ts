export const worldShader = /* wgsl */ `
struct Scene { vp:mat4x4f, light:mat4x4f, camera:vec4f, sun:vec4f, fog:vec4f }
@group(0) @binding(0) var<uniform> scene:Scene;
@group(0) @binding(1) var pictures:texture_2d_array<f32>;
@group(0) @binding(2) var pictureSampler:sampler;
@group(0) @binding(3) var shadow:texture_depth_2d;
@group(0) @binding(4) var shadowSampler:sampler_comparison;
struct Input { @location(0) pos:vec3f,@location(1) normal:vec3f,@location(2) uv:vec2f,@location(3) color:vec4f,@location(4) material:vec2f }
struct V { @builtin(position) pos:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) uv:vec2f,@location(3) color:vec4f,@location(4) @interpolate(flat) material:vec2f,@location(5) shadowPos:vec4f }
@vertex fn mainVertex(v:Input)->V {var o:V;o.pos=scene.vp*vec4(v.pos,1.);o.world=v.pos;o.normal=v.normal;o.uv=v.uv;o.color=v.color;o.material=v.material;o.shadowPos=scene.light*vec4(v.pos,1.);return o;}
@vertex fn outlineVertex(v:Input)->V {var o:V;o.pos=scene.vp*vec4(v.pos+v.normal*.018,1.);o.world=v.pos;o.normal=v.normal;o.uv=v.uv;o.color=v.color;o.material=v.material;o.shadowPos=scene.light*vec4(v.pos,1.);return o;}
@vertex fn shadowVertex(v:Input)->V {var o:V;o.pos=scene.light*vec4(v.pos,1.);o.world=v.pos;o.normal=v.normal;o.uv=v.uv;o.color=v.color;o.material=v.material;o.shadowPos=o.pos;return o;}
@fragment fn shadowFragment(v:V) {if(v.material.x>=0.){let pixel=textureSampleLevel(pictures,pictureSampler,v.uv,i32(v.material.x),0.);if(pixel.a<.2){discard;}}}
fn visibility(v:V)->f32 {
  let p=v.shadowPos.xyz/v.shadowPos.w;let uv=vec2(p.x*.5+.5,.5-p.y*.5);
  if(any(uv<vec2(0.))||any(uv>vec2(1.))||p.z>1.){return 1.;}
  let texel=1./f32(textureDimensions(shadow).x);var result=0.;
  for(var x=-1;x<=1;x++){for(var y=-1;y<=1;y++){result+=textureSampleCompareLevel(shadow,shadowSampler,uv+vec2(f32(x),f32(y))*texel,p.z-.002);}}
  return result/9.;
}
@fragment fn mainFragment(v:V)->@location(0) vec4f {
  var base=v.color.rgb;var unlit=0.;
  if(v.material.x>=0.){let picture=textureSampleLevel(pictures,pictureSampler,v.uv,i32(v.material.x),0.);if(picture.a<.15){discard;}base=picture.rgb;unlit=1.;}
  let n=normalize(v.normal);let lambert=max(dot(n,normalize(scene.sun.xyz)),0.);
  let toon=floor(lambert*3.+.4)/3.;let sun=visibility(v);
  let lighting=vec3(.65,.69,.75)+vec3(1.,.86,.65)*toon*.85*sun;
  let grain=1.-.035*sin(v.world.x*27.+sin(v.world.z*2.)*2.);
  var color=mix(base*lighting*grain,base,unlit);
  color+=base*v.material.y*(.84+.16*sin(scene.camera.w*1.6+v.world.x));
  let distance=length(scene.camera.xyz-v.world);let fog=1.-exp(-distance*scene.fog.w);
  color=mix(color,scene.fog.rgb,clamp(fog,0.,.86));
  return vec4(color,1.);
}
@fragment fn outlineFragment(v:V)->@location(0) vec4f {if(v.material.x>=0.){discard;}let fog=1.-exp(-length(scene.camera.xyz-v.world)*scene.fog.w);return vec4(mix(vec3(.045,.035,.03),scene.fog.rgb,fog),1.);}
`;
