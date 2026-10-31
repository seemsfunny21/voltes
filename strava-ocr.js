'use strict';
// Optional on-device OCR for Strava screenshots. Nothing is uploaded or auto-saved.
(function(scope){
 const CDN='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
 let loading;
 function loadEngine(){
  if(scope.Tesseract?.recognize)return Promise.resolve(scope.Tesseract);
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src=CDN;script.async=true;script.crossOrigin='anonymous';
   script.onload=()=>scope.Tesseract?.recognize?resolve(scope.Tesseract):reject(Error('Το εργαλείο αναγνώρισης δεν φορτώθηκε.'));
   script.onerror=()=>reject(Error('Δεν ήταν δυνατή η φόρτωση OCR. Συμπλήρωσε τα στοιχεία χειροκίνητα.'));
   document.head.appendChild(script);
  }).catch(err=>{loading=null;throw err});
  return loading;
 }
 function parse(text){
  const lines=String(text||'').replace(/\u00a0/g,' ').split(/\n/).map(x=>x.trim()).filter(Boolean);
  const joined=lines.join(' | ');
  const decimal=s=>Number(String(s).replace(/\s/g,'').replace(',','.'));
  let speed=null,km=null,elevationGain=null,movingTime=null;
  // Accept commas and periods; distinguish km from km/h.
  const speeds=[...joined.matchAll(/(\d{1,3}(?:[.,]\d{1,2})?)\s*k\s*m\s*[\/]\s*h\b/gi)];
  if(speeds.length)speed=decimal(speeds[speeds.length-1][1]);
  const distances=[...joined.matchAll(/(\d{1,4}(?:[.,]\d{1,2})?)\s*k\s*m(?!\s*[\/]\s*h)\b/gi)];
  if(distances.length)km=decimal(distances[distances.length-1][1]);
  const times=[...joined.matchAll(/\b(\d{1,3}):([0-5]\d)(?::([0-5]\d))?\b/g)];
  if(times.length){const m=times[0];movingTime=Number(m[1])+':'+m[2]}
  const elevations=[...joined.matchAll(/\b(\d{1,5}(?:[.,]\d{1,2})?)\s*m\b(?!\s*[\/]\s*s)/gi)];
  if(elevations.length)elevationGain=Math.round(decimal(elevations[elevations.length-1][1]));
  // Accept only values in the same ranges as the manual form.
  const valid=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max?n:null;
  return {km:valid(km,.1,1000),speed:valid(speed,1,100),elevationGain:valid(elevationGain,0,50000),movingTime,rawText:lines.join('\n')};
 }
 async function read(file,onProgress=()=>{}){
  if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>10*1024*1024)throw Error('Επίλεξε εικόνα JPG, PNG ή WebP έως 10 MB.');
  const engine=await loadEngine();
  const result=await engine.recognize(file,'eng',{logger:m=>{if(m.status==='recognizing text')onProgress(Math.round((m.progress||0)*100))}});
  return parse(result.data?.text);
 }
 scope.VoltesStravaOCR={read,parse};
})(globalThis);
