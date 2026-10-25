// Native Bun.WebView capture of the same local page used by the interactive QA tab.
const width = Number(Bun.argv[2] ?? 1536),
  height = Number(Bun.argv[3] ?? 1024),
  name = Bun.argv[4] ?? "home-desktop.jpg";
if (!/^[a-z0-9-]+\.jpg$/.test(name)) throw new Error("Invalid screenshot name");
await using view = new Bun.WebView({
  width,
  height,
  backend: { type: "chrome", url: false },
});
await view.navigate("http://127.0.0.1:3000/");
await view.resize(width, height);
const status = await view.evaluate(
  `new Promise(resolve=>{let done=false,readyAt=0;const finish=()=>{if(done)return;done=true;clearInterval(check);resolve({width:innerWidth,height:innerHeight,status:document.querySelector('.scene-stage')?.dataset.status,gpu:{...document.querySelector('.scene-stage canvas')?.dataset},title:document.title})};const check=setInterval(()=>{const status=document.querySelector('.scene-stage')?.dataset.status;if(status==='ready'&&!readyAt)readyAt=performance.now();if((['error','lost','unavailable'].includes(status)||(readyAt&&performance.now()-readyAt>900))&&(!document.querySelector('.brand img')||document.querySelector('.brand img').complete))finish()},50);setTimeout(finish,15000)})`,
);
await Bun.write(
  `${import.meta.dir}/references/${name}`,
  await view.screenshot({ format: "jpeg", quality: 92 }),
);
console.log(
  JSON.stringify({ path: `${import.meta.dir}/references/${name}`, ...status }),
);
