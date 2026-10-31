'use strict';
(function(scope){
 function formatMovingTime(minutes){return Math.floor(minutes/60)+':'+String(minutes%60).padStart(2,'0')}
 function validateCompletion(input){
  const number=(value,min,max,label,integer=false)=>{if(value==null||String(value).trim()==='')throw Error('Συμπλήρωσε '+label+'.');const n=Number(value);if(!Number.isFinite(n)||n<min||n>max||(integer&&!Number.isInteger(n)))throw Error('Μη έγκυρη τιμή: '+label+'.');return n};
  const km=number(input.km,0.1,1000,'απόσταση'),speed=number(input.speed,1,100,'μέση ταχύτητα');
  const elevationGain=number(input.elevationGain,0,50000,'υψομετρική ανάβαση',true);
  const match=/^(\d{1,3}):([0-5]\d)$/.exec(String(input.movingTime||'').trim());
  if(!match)throw Error('Ο χρόνος κίνησης πρέπει να είναι ώρες:λεπτά, π.χ. 1:40.');
  const movingMinutes=Number(match[1])*60+Number(match[2]);
  if(movingMinutes===0)throw Error('Ο χρόνος κίνησης πρέπει να είναι μεγαλύτερος από μηδέν.');
  const names=(value)=>{if(!Array.isArray(value)||value.length>50)throw Error('Μη έγκυρη λίστα συμμετεχόντων.');return [...new Set(value.map(n=>{if(typeof n!=='string'||n.trim().length<2||n.length>70)throw Error('Μη έγκυρο όνομα συμμετέχοντα.');return n.trim()}))]};
  const attendees=names(input.attendees),slowed=names(input.slowed||[]);
  if(!attendees.length)throw Error('Επίλεξε τουλάχιστον έναν πραγματικό συμμετέχοντα.');
  if(slowed.some(n=>!attendees.includes(n)))throw Error('Η παρατήρηση ρυθμού επιτρέπεται μόνο για πραγματικούς συμμετέχοντες.');
  const slowdownNotes=String(input.slowdownNotes||'').trim();
  if(slowdownNotes.length>2000)throw Error('Η ιδιωτική παρατήρηση μπορεί να έχει έως 2000 χαρακτήρες.');
  const strava=String(input.strava||'').trim();
  if(strava){let url;try{url=new URL(strava)}catch{throw Error('Μη έγκυρος σύνδεσμος Strava.')}if(url.protocol!=='https:'||!['strava.com','www.strava.com'].includes(url.hostname)||url.port||url.username||url.password)throw Error('Μη έγκυρος σύνδεσμος Strava.')}
  return {km,speed,elevationGain,movingMinutes,attendees,slowed,slowdownNotes,strava};
 }
 scope.VoltesCompletion={formatMovingTime,validateCompletion};
})(globalThis);
