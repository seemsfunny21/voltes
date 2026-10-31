const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
let demoSession=false;let demoAvatar=null;let demoSignupToken=null;let ride={id:'12345678-1234-1234-1234-123456789abc',date:'2026-11-01',time:'09:00',place:'Πλατεία Μαβίλη',title:'Γύρος λίμνης',done:false,signups:[{name:'Δοκιμαστικός ποδηλάτης'}],attendees:[],slowed:[]};
http.createServer(async(req,res)=>{
res.setHeader('Cache-Control','no-store');
if(req.url==='/config.js'){res.setHeader('Content-Type','text/javascript');return res.end('window.VOLTES_API_URL="http://127.0.0.1:8765/api";')}
if(req.url==='/sw.js'){res.statusCode=404;return res.end()}
if(req.url==='/api'){
let body='';for await(const chunk of req)body+=chunk;const p=JSON.parse(body),admin=p.pin==='1234'||(demoSession&&p.adminToken==='demo-admin');
res.setHeader('Content-Type','application/json');
if(p.action==='login'){if(!admin){res.statusCode=403;return res.end(JSON.stringify({error:'Δοκιμαστικό PIN: 1234'}))}demoSession=true;return res.end(JSON.stringify({ok:true,adminToken:'demo-admin'}))}
if(p.action==='logout'){demoSession=false;return res.end(JSON.stringify({ok:true}))}
if(p.action==='signup'){demoSignupToken=p.cancelToken;ride.signups=[{name:p.name}];return res.end(JSON.stringify({ok:true}))}
if(p.action==='cancelSignup'){if(demoSignupToken===p.cancelToken){demoSignupToken=null;ride.signups=[]}return res.end(JSON.stringify({ok:true}))}
if(p.action==='setAvatar'&&admin){demoAvatar=p.avatar;return res.end(JSON.stringify({ok:true}))}
ride.mySignup=!!demoSignupToken&&p.signupTokens?.[ride.id]===demoSignupToken;
if(p.action==='finish'){if(!admin){res.statusCode=403;return res.end(JSON.stringify({error:'Απαιτείται Admin'}))}Object.assign(ride,p,{done:true});delete ride.pin;return res.end(JSON.stringify({ok:true}))}
return res.end(JSON.stringify({rides:[admin?ride:{id:ride.id,date:ride.date,time:ride.time,place:ride.place,title:ride.title,done:ride.done,km:ride.km,elevationGain:ride.elevationGain,movingMinutes:ride.movingMinutes,attendeeCount:ride.attendees.length,signupCount:ride.signups.length,mySignup:ride.mySignup}],riders:admin?[{id:'12345678-1234-1234-1234-123456789abd',name:'Δοκιμαστικός ποδηλάτης',member:true,avatar_data_url:demoAvatar}]:[],members:1,admin,capabilities:{rideCompletionV2:true}}));
}
const name=decodeURIComponent(req.url.split('?')[0]);const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)){res.statusCode=403;return res.end()}
try{res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file))}catch{res.statusCode=404;res.end()}
}).listen(8765,'127.0.0.1',()=>console.log('Test preview http://127.0.0.1:8765'));
