// Bounded smoke check using the requested native Bun.WebView surface.
await using view = new Bun.WebView({
  width: 1200,
  height: 900,
  backend: { type: "chrome", url: false },
});
await view.navigate("http://127.0.0.1:3000/");
const wait = async (expression) =>
  view.evaluate(
    `new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{try{if(${expression}){clearInterval(t);resolve(true)}}catch{}if(++n>200){clearInterval(t);reject(new Error('UI condition timed out'))}},50)})`,
  );
await wait("document.querySelector('.scene-stage')?.dataset.status==='ready'");
await wait(
  "document.querySelector('.scene-stage canvas')?.dataset.sourceLayers==='3'",
);
const gpu = await view.evaluate(
  "({...document.querySelector('.scene-stage canvas').dataset})",
);
if (
  gpu.renderer !== "webgpu" ||
  gpu.sourceLayers !== "3" ||
  gpu.sourceMasks !== "1" ||
  gpu.rasterizedSvg !== "2" ||
  !gpu.gpuPipelines?.includes("render,compute,particles") ||
  gpu.gpuError
)
  throw new Error("WebGPU planes/mask qualification failed");
console.log(JSON.stringify({ gpu }));
await view.evaluate(
  "(()=>{const canvas=document.querySelector('.scene-stage canvas');canvas.focus();canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'+',bubbles:true}))})()",
);
await wait(
  "Number(document.querySelector('.scene-controls input[type=range]')?.value)>1",
);
await view.evaluate(
  "(()=>{const canvas=document.querySelector('.scene-stage canvas');canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'0',bubbles:true}))})()",
);
await wait(
  "Number(document.querySelector('.scene-controls input[type=range]')?.value)===1",
);
await view.evaluate(
  "document.querySelector('.scene-stage canvas').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))",
);
await wait(
  "document.querySelector('.scene-controls .control-button[aria-pressed]')?.getAttribute('aria-pressed')==='true'",
);
await view.evaluate(
  "document.querySelector('.scene-stage canvas').dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}))",
);
await wait(
  "document.querySelector('.scene-controls .control-button[aria-pressed]')?.getAttribute('aria-pressed')==='false'",
);
await view.evaluate(
  "document.querySelector('.mode-switch button:nth-child(2)').click()",
);
await wait(
  `document.querySelector('.scene-stage')?.dataset.status==='ready'&&document.querySelector('.scene-stage canvas')?.dataset.sourceScene!=='${gpu.sourceScene}'`,
);
console.log(
  await view.evaluate(
    "JSON.stringify({animeGpu:{...document.querySelector('.scene-stage canvas').dataset}})",
  ),
);
await view.evaluate(
  "document.querySelector('.mode-switch button:first-child').click()",
);
await wait(
  `document.querySelector('.scene-stage')?.dataset.status==='ready'&&document.querySelector('.scene-stage canvas')?.dataset.sourceScene==='${gpu.sourceScene}'`,
);
await view.evaluate(
  "[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Anime').click()",
);
await wait("document.querySelector('dialog[open] .video-list button')");
console.log(
  await view.evaluate(
    "JSON.stringify({dialog:document.querySelector('dialog[open] h2')?.textContent,videoChoices:document.querySelectorAll('dialog[open] .video-list button').length,iframe:document.querySelector('dialog[open] iframe')?.src})",
  ),
);
await view.evaluate(
  "[...document.querySelectorAll('.video-list button')].find(x=>x.textContent.includes('aperçu vidéo public Netflix')).click()",
);
await wait(
  "document.querySelector('dialog[open] video')?.readyState>=1 || document.querySelector('dialog[open] video')?.error",
);
console.log(
  await view.evaluate(
    "JSON.stringify({promoLabel:document.querySelector('dialog[open]')?.textContent.includes('pas un épisode'),video:{readyState:document.querySelector('video')?.readyState,duration:document.querySelector('video')?.duration,error:document.querySelector('video')?.error?.message}})",
  ),
);
await view.evaluate(
  "document.querySelector('dialog[open] button[aria-label^=Fermer]').click()",
);
await view.evaluate(
  "[...document.querySelectorAll('header button')].find(x=>x.textContent.trim()==='Wiki').click()",
);
await wait(
  "document.querySelector('dialog[open] #wiki-query') && document.querySelector('dialog[open] .wiki-results button')",
);
console.log(
  await view.evaluate(
    "JSON.stringify({wikiResults:document.querySelectorAll('.wiki-results button').length,title:document.querySelector('dialog[open] h2')?.textContent})",
  ),
);
