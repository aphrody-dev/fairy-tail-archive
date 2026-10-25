await using view = new Bun.WebView({
  width: 1200,
  height: 900,
  backend: { type: "chrome", url: false },
});
await view.navigate("http://127.0.0.1:3000/");
const result = await view.evaluate(
  `new Promise(resolve=>{let n=0;const t=setInterval(()=>{const el=document.querySelector('.scene-stage'),canvas=el?.querySelector('canvas');if((['ready','error','unavailable','lost'].includes(el?.dataset.status)&&Number(canvas?.dataset.gpuFrames)>1)||++n>200){clearInterval(t);resolve({status:el?.dataset.status,message:el?.querySelector('[role=status]')?.textContent,...canvas?.dataset,webgpu:!!navigator.gpu})}},50)})`,
);
console.log(JSON.stringify(result));
if (
  result.status !== "ready" ||
  result.renderer !== "webgpu" ||
  result.sourceLayers !== "3" ||
  result.sourceMasks !== "1" ||
  result.rasterizedSvg !== "2" ||
  result.gpuError
)
  throw new Error("WebGPU source planes/mask qualification failed");
